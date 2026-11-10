import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { authPrisma, getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";
import { decryptPixKey, maskPixKey } from "@/lib/wallet/pix-key-crypto";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };

async function requireAdmin(request: NextRequest) {
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return { response: NextResponse.json({ error: "É necessário entrar na conta." }, { status: 401, headers }) };
  if (user.role !== "ADMIN" || user.mustChangePassword) return { response: NextResponse.json({ error: "Acesso não permitido." }, { status: 403, headers }) };
  return { user };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  try {
    const include = {
      user: { select: { id: true, username: true } },
      reviewedBy: { select: { username: true } },
      statusHistory: { select: { fromStatus: true, toStatus: true, note: true, createdAt: true, actor: { select: { username: true } } }, orderBy: { createdAt: "asc" as const } },
    };
    // Never let old/closed records consume the limit and hide an actionable pending withdrawal.
    const [pendingWithdrawals, historicalWithdrawals] = await Promise.all([
      authPrisma.withdrawal.findMany({
        where: { status: "PENDING" },
        include,
        orderBy: { createdAt: "asc" },
      }),
      authPrisma.withdrawal.findMany({
        where: { status: { in: ["APPROVED", "PROCESSING", "PAID", "REJECTED"] } },
        include,
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    ]);
    const withdrawals = [...pendingWithdrawals, ...historicalWithdrawals];
    let keyConfigError = false;
    const items = withdrawals.map((item) => {
      let pixKey: string | null = null;
      if (["PENDING", "APPROVED", "PROCESSING"].includes(item.status)) {
        try { pixKey = decryptPixKey(item.pixKeyEncrypted); } catch { keyConfigError = true; }
      }
      return {
        id: item.id, username: item.user.username, amountCents: item.amountCents, status: item.status,
        pixKey, pixKeyMasked: (() => { try { return maskPixKey(decryptPixKey(item.pixKeyEncrypted)); } catch { return "Chave indisponível"; } })(),
        providerRef: item.providerRef, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(),
        reviewedBy: item.reviewedBy?.username ?? null,
        statusHistory: item.statusHistory.map((event) => ({ fromStatus: event.fromStatus, toStatus: event.toStatus, note: event.note, createdAt: event.createdAt.toISOString(), actor: event.actor?.username ?? "Sistema" })),
      };
    });
    if (keyConfigError && withdrawals.some((item) => ["PENDING", "APPROVED", "PROCESSING"].includes(item.status))) {
      return NextResponse.json({ error: "Configure WALLET_PIX_ENCRYPTION_KEY para abrir as chaves Pix pendentes. Os saques continuam preservados." }, { status: 503, headers });
    }
    return NextResponse.json({ items }, { headers });
  } catch {
    return NextResponse.json({ error: "Não foi possível consultar os saques." }, { status: 500, headers });
  }
}

const actionSchema = z.object({
  withdrawalId: z.string().min(1).max(128),
  action: z.enum(["mark-paid", "reject"]),
  note: z.string().trim().min(4).max(500),
  providerRef: z.string().trim().min(3).max(200).optional(),
}).strict();

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return NextResponse.json({ error: "Requisição inválida." }, { status: 403, headers });
  if (origin) {
    let originHost = "";
    try {
      const parsedOrigin = new URL(origin);
      if (parsedOrigin.protocol !== "https:" && parsedOrigin.protocol !== "http:") {
        return NextResponse.json({ error: "Requisição inválida." }, { status: 403, headers });
      }
      originHost = parsedOrigin.host.toLowerCase();
    } catch {
      return NextResponse.json({ error: "Requisição inválida." }, { status: 403, headers });
    }
    const requestHost = request.headers.get("host")?.trim().toLowerCase();
    if (!requestHost || originHost !== requestHost) {
      return NextResponse.json({ error: "Requisição inválida." }, { status: 403, headers });
    }
  }
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400, headers }); }
  const parsed = actionSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Informe a solicitação e uma observação de auditoria válida." }, { status: 400, headers });

  try {
    const result = await authPrisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>('SELECT "id" FROM "Withdrawal" WHERE "id" = $1 FOR UPDATE', parsed.data.withdrawalId);
      if (!rows.length) throw new Error("NOT_FOUND");
      const withdrawal = await tx.withdrawal.findUnique({ where: { id: parsed.data.withdrawalId }, include: { user: { select: { username: true } } } });
      if (!withdrawal) throw new Error("NOT_FOUND");
      if (parsed.data.action === "mark-paid") {
        if (withdrawal.status !== "PENDING") throw new Error("INVALID_STATE");
        const reference = parsed.data.providerRef?.trim() || null;
        const paid = await tx.withdrawal.update({ where: { id: withdrawal.id }, data: { status: "PAID", reviewedById: auth.user.id, ...(reference ? { providerRef: reference } : {}) } });
        await tx.ledgerEntry.create({ data: {
          userId: withdrawal.userId, withdrawalId: withdrawal.id, type: "WITHDRAWAL_PAID",
          amountCents: 0, currency: "BRL", idempotencyKey: "withdrawal-paid:" + withdrawal.id,
          description: "Registro auditável de pagamento Pix externo do saque " + withdrawal.id + (reference ? "; referência " + reference : ""),
        } });
        await tx.withdrawalStatusHistory.create({ data: {
          withdrawalId: withdrawal.id, fromStatus: "PENDING", toStatus: "PAID", actorId: auth.user.id,
          note: parsed.data.note.trim() + (reference ? " | Referência Pix externa: " + reference : " | Pix realizado manualmente e conferido"),
        } });
        await tx.auditEvent.create({ data: {
          actorId: auth.user.id, action: "WITHDRAWAL_MARKED_PAID", entityType: "Withdrawal", entityId: withdrawal.id,
          metadata: { userId: withdrawal.userId, username: withdrawal.user.username, amountCents: withdrawal.amountCents, providerRef: reference, note: parsed.data.note.trim(), pixKeyMasked: maskPixKey(decryptPixKey(withdrawal.pixKeyEncrypted)), paidAt: new Date().toISOString(), manualProviderConfirmation: true, payoutHandledOutsidePlatform: true },
        } });
        return { id: paid.id, status: paid.status, username: withdrawal.user.username, amountCents: withdrawal.amountCents };
      }
      if (withdrawal.status !== "PENDING") throw new Error("INVALID_STATE");
      await tx.withdrawal.update({ where: { id: withdrawal.id }, data: { status: "REJECTED", reviewedById: auth.user.id } });
      await tx.ledgerEntry.create({ data: {
        userId: withdrawal.userId, withdrawalId: withdrawal.id, type: "WITHDRAWAL_RELEASE",
        amountCents: withdrawal.amountCents, currency: "BRL", idempotencyKey: "withdrawal-release:" + withdrawal.id,
        description: "Liberação de reserva após rejeição do saque " + withdrawal.id,
      } });
      await tx.withdrawalStatusHistory.create({ data: { withdrawalId: withdrawal.id, fromStatus: "PENDING", toStatus: "REJECTED", actorId: auth.user.id, note: parsed.data.note.trim() } });
      await tx.auditEvent.create({ data: {
        actorId: auth.user.id, action: "WITHDRAWAL_REJECTED", entityType: "Withdrawal", entityId: withdrawal.id,
        metadata: { userId: withdrawal.userId, username: withdrawal.user.username, amountCents: withdrawal.amountCents, note: parsed.data.note.trim(), releasedCents: withdrawal.amountCents },
      } });
      return { id: withdrawal.id, status: "REJECTED", username: withdrawal.user.username, amountCents: withdrawal.amountCents };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ success: true, withdrawal: result }, { headers });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return NextResponse.json({ error: "O saque foi atualizado simultaneamente. Atualize a lista." }, { status: 409, headers });
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return NextResponse.json({ error: "Solicitação de saque não encontrada." }, { status: 404, headers });
    if (code === "INVALID_STATE") return NextResponse.json({ error: "Este saque não está pendente. Atualize a lista antes de tentar novamente." }, { status: 409, headers });
    if (code === "WALLET_PIX_ENCRYPTION_KEY_MISSING" || code === "WALLET_PIX_ENCRYPTION_KEY_INVALID") return NextResponse.json({ error: "Configure a chave de criptografia de chaves Pix antes de consultar ou registrar pagamentos de saques." }, { status: 503, headers });
    return NextResponse.json({ error: "Não foi possível concluir a operação do saque." }, { status: 500, headers });
  }
}
