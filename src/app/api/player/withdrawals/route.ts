import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { authPrisma, getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";
import { encryptPixKey, isPlausiblePixKey, maskPixKey } from "@/lib/wallet/pix-key-crypto";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "É necessário entrar na conta." }, { status: 401, headers });
  if (user.role !== "PLAYER" || user.mustChangePassword) return NextResponse.json({ error: "Acesso não permitido." }, { status: 403, headers });
  try {
    const [ledger, withdrawals] = await Promise.all([
      authPrisma.ledgerEntry.aggregate({ where: { userId: user.id }, _sum: { amountCents: true } }),
      authPrisma.withdrawal.findMany({
        where: { userId: user.id },
        select: { id: true, amountCents: true, status: true, providerRef: true, createdAt: true, updatedAt: true, statusHistory: { select: { toStatus: true, note: true, createdAt: true }, orderBy: { createdAt: "asc" } } },
        orderBy: { createdAt: "desc" }, take: 100,
      }),
    ]);
    return NextResponse.json({
      availableCents: ledger._sum.amountCents ?? 0,
      withdrawals: withdrawals.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(), statusHistory: item.statusHistory.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })) })),
    }, { headers });
  } catch {
    return NextResponse.json({ error: "Não foi possível consultar a carteira." }, { status: 500, headers });
  }
}

const requestSchema = z.object({
  pixKey: z.string().trim().min(3).max(200).refine(isPlausiblePixKey, "Informe uma chave Pix em formato de e-mail, telefone, CPF/CNPJ ou chave aleatória UUID."),
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
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "É necessário entrar na conta." }, { status: 401, headers });
  if (user.role !== "PLAYER" || user.mustChangePassword) return NextResponse.json({ error: "Acesso não permitido." }, { status: 403, headers });
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400, headers }); }
  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Informe uma chave Pix válida." }, { status: 400, headers });
  let encryptedPixKey: string;
  try { encryptedPixKey = encryptPixKey(parsed.data.pixKey); }
  catch { return NextResponse.json({ error: "A chave de criptografia de chaves Pix não está configurada corretamente. O saque não foi solicitado." }, { status: 503, headers }); }

  try {
    const result = await authPrisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT "id" FROM "User" WHERE "id" = $1 FOR UPDATE', user.id);
      const ledger = await tx.ledgerEntry.aggregate({ where: { userId: user.id }, _sum: { amountCents: true } });
      const available = ledger._sum.amountCents ?? 0;
      if (available <= 0) throw new Error("INSUFFICIENT_BALANCE");
      const amountCents = available;
      const withdrawal = await tx.withdrawal.create({ data: {
        userId: user.id, amountCents, pixKeyEncrypted: encryptedPixKey,
        idempotencyKey: "withdrawal:" + randomUUID(),
      } });
      await tx.ledgerEntry.create({ data: {
        userId: user.id, withdrawalId: withdrawal.id, type: "WITHDRAWAL_RESERVE",
        amountCents: -amountCents, currency: "BRL",
        idempotencyKey: "withdrawal-reserve:" + withdrawal.id,
        description: "Reserva de saldo para solicitação de saque " + withdrawal.id,
      } });
      await tx.withdrawalStatusHistory.create({ data: { withdrawalId: withdrawal.id, fromStatus: null, toStatus: "PENDING", actorId: user.id, note: "Solicitação de saque enviada pelo jogador." } });
      await tx.auditEvent.create({ data: {
        actorId: user.id, action: "WITHDRAWAL_REQUESTED", entityType: "Withdrawal", entityId: withdrawal.id,
        metadata: { amountCents: withdrawal.amountCents, pixKeyMasked: maskPixKey(parsed.data.pixKey), status: "PENDING" },
      } });
      return { id: withdrawal.id, amountCents: withdrawal.amountCents, status: withdrawal.status, createdAt: withdrawal.createdAt.toISOString(), availableCents: available - withdrawal.amountCents };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ success: true, withdrawal: result }, { status: 201, headers });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return NextResponse.json({ error: "A carteira foi atualizada simultaneamente. Atualize o saldo e tente novamente." }, { status: 409, headers });
    if (error instanceof Error && error.message === "INSUFFICIENT_BALANCE") return NextResponse.json({ error: "O valor solicitado é maior que o saldo disponível." }, { status: 409, headers });
    return NextResponse.json({ error: "Não foi possível solicitar o saque." }, { status: 500, headers });
  }
}
