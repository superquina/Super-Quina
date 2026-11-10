import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { authPrisma, getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";
import { calculateNumberPrizeCents } from "@/modules/numbers/calculate-number-prize";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
async function adminFromRequest(request: NextRequest) {
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return { response: NextResponse.json({ error: "É necessário entrar na conta." }, { status: 401, headers }) };
  if (user.role !== "ADMIN" || user.mustChangePassword) return { response: NextResponse.json({ error: "Acesso não permitido." }, { status: 403, headers }) };
  return { user };
}
export async function GET(request: NextRequest) {
  const auth = await adminFromRequest(request);
  if (auth.response) return auth.response;
  try {
    // Select only winning online-player lines whose credit timestamp or ledger
    // entry is inconsistent. Paid prizes are deliberately excluded from repair.
    const candidates = await authPrisma.$queryRaw<Array<{ id: string }>>`
      SELECT line."id"
      FROM "NumericParticipationLine" AS line
      INNER JOIN "PurchaseParticipation" AS participation
        ON participation."id" = line."participationId"
      INNER JOIN "Round" AS round
        ON round."id" = participation."roundId"
      INNER JOIN "Purchase" AS purchase
        ON purchase."id" = participation."purchaseId"
      LEFT JOIN "LedgerEntry" AS ledger
        ON ledger."idempotencyKey" = 'numeric-prize-credit:' || line."id"
      LEFT JOIN "NumericPrizePayout" AS payout
        ON payout."participationLineId" = line."id"
      WHERE line."prizeCents" > 0
        AND participation."status" = 'CONFIRMED'
        AND round."status" = 'COMPLETED'
        AND round."resultNumber" IS NOT NULL
        AND purchase."status" = 'CONFIRMED'
        AND purchase."playerId" IS NOT NULL
        AND purchase."cashierId" IS NULL
        AND payout."id" IS NULL
        AND (
          line."prizeCreditedAt" IS NULL
          OR ledger."id" IS NULL
          OR ledger."userId" IS DISTINCT FROM purchase."playerId"
          OR ledger."purchaseId" IS DISTINCT FROM purchase."id"
          OR ledger."amountCents" IS DISTINCT FROM line."prizeCents"
          OR ledger."currency" IS DISTINCT FROM purchase."currency"
          OR ledger."type" IS DISTINCT FROM 'PRIZE_CREDIT'
          OR ledger."participationId" IS DISTINCT FROM participation."id"
        )
      ORDER BY line."createdAt" ASC, line."id" ASC
      LIMIT 200
    `;
    const candidateIds = candidates.map((candidate) => candidate.id);
    const fetchedLines = candidateIds.length ? await authPrisma.numericParticipationLine.findMany({
      where: { id: { in: candidateIds } },
      select: {
        id: true, numberValue: true, prizeCents: true, prizeCreditedAt: true, createdAt: true,
        prizePayout: { select: { channel: true, paidAt: true } },
        participation: { select: {
          id: true, round: { select: { id: true, code: true, resultAt: true, resultNumber: true } },
          purchase: { select: { id: true, createdAt: true, playerId: true, currency: true, player: { select: { username: true } } } },
        } },
      },
    }) : [];
    const linesById = new Map(fetchedLines.map((line) => [line.id, line]));
    const lines = candidateIds.flatMap((id) => {
      const line = linesById.get(id);
      return line ? [line] : [];
    });
    const items = await Promise.all(lines.map(async (line) => {
      const entry = await authPrisma.ledgerEntry.findUnique({ where: { idempotencyKey: "numeric-prize-credit:" + line.id } });
      return {
        lineId: line.id, numberValue: line.numberValue, prizeCents: line.prizeCents,
        roundCode: line.participation.round.code, resultAt: line.participation.round.resultAt.toISOString(),
        purchaseCreatedAt: line.participation.purchase.createdAt.toISOString(),
        playerId: line.participation.purchase.playerId,
        username: line.participation.purchase.player?.username ?? "Conta indisponível",
        ledgerEntryExists: Boolean(entry),
        ledgerMatches: Boolean(entry && entry.userId === line.participation.purchase.playerId &&
          entry.purchaseId === line.participation.purchase.id && entry.amountCents === line.prizeCents &&
          entry.currency === line.participation.purchase.currency && entry.type === "PRIZE_CREDIT" &&
          entry.participationId === line.participation.id),
        prizeCreditedAt: line.prizeCreditedAt?.toISOString() ?? null,
        payoutExists: Boolean(line.prizePayout),
        payoutChannel: line.prizePayout?.channel ?? null,
        payoutAt: line.prizePayout?.paidAt.toISOString() ?? null,
      };
    }));
    return NextResponse.json({ items, count: items.length, limit: 200 }, { headers });
  } catch {
    return NextResponse.json({ error: "Não foi possível consultar os créditos pendentes." }, { status: 500, headers });
  }
}
const repairSchema = z.object({ lineId: z.string().min(1).max(128), reason: z.string().trim().min(8).max(500) }).strict();
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
  const auth = await adminFromRequest(request);
  if (auth.response) return auth.response;
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400, headers }); }
  const parsed = repairSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Informe a linha do prêmio e um motivo com pelo menos 8 caracteres." }, { status: 400, headers });
  try {
    const result = await authPrisma.$transaction(async (tx) => {
      const line = await tx.numericParticipationLine.findUnique({
        where: { id: parsed.data.lineId },
        include: { prizePayout: true, participation: { include: { round: true, purchase: { include: { player: true } } } } },
      });
      if (!line) throw new Error("LINE_NOT_FOUND");
      const purchase = line.participation.purchase;
      const round = line.participation.round;
      const playerId = purchase.playerId;
      if (!playerId || purchase.cashierId !== null || !purchase.player || purchase.status !== "CONFIRMED" ||
          line.participation.status !== "CONFIRMED" || round.status !== "COMPLETED" || !round.resultNumber) throw new Error("NOT_ELIGIBLE");
      if (line.prizePayout) throw new Error("ALREADY_PAID");
      if (line.prizeCents === null || line.prizeCents <= 0) throw new Error("NO_PRIZE");
      let recalculated: number;
      try {
        recalculated = calculateNumberPrizeCents({
          numberValue: line.numberValue, unitCents: line.unitCents, tensCents: line.tensCents,
          hundredsCents: line.hundredsCents, thousandsCents: line.thousandsCents,
          quinaCents: line.quinaCents, ruleVersion: line.ruleVersion, ruleSnapshot: line.ruleSnapshot,
        }, round.resultNumber);
      } catch { throw new Error("PRIZE_MISMATCH"); }
      if (recalculated <= 0 || recalculated !== line.prizeCents) throw new Error("PRIZE_MISMATCH");
      const idempotencyKey = "numeric-prize-credit:" + line.id;
      const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey } });
      let creditedNow = false;
      if (existing) {
        if (existing.userId !== playerId || existing.purchaseId !== purchase.id ||
            existing.amountCents !== recalculated || existing.currency !== purchase.currency ||
            existing.type !== "PRIZE_CREDIT" || existing.participationId !== line.participationId) throw new Error("LEDGER_CONFLICT");
      } else {
        await tx.ledgerEntry.create({ data: {
          userId: playerId, purchaseId: purchase.id, participationId: line.participationId,
          type: "PRIZE_CREDIT", amountCents: recalculated, currency: purchase.currency,
          idempotencyKey, description: "Crédito corretivo de prêmio da rodada " + round.code + " — linha " + line.id,
        } });
        creditedNow = true;
      }
      if (!line.prizeCreditedAt) await tx.numericParticipationLine.update({ where: { id: line.id }, data: { prizeCreditedAt: new Date() } });
      await tx.auditEvent.create({ data: {
        actorId: auth.user.id, action: creditedNow ? "PLAYER_PRIZE_CREDIT_REPAIRED" : "PLAYER_PRIZE_CREDIT_RECONCILED",
        entityType: "NumericParticipationLine", entityId: line.id,
        metadata: { playerId, username: purchase.player.username, purchaseId: purchase.id,
          participationId: line.participationId, roundId: round.id, roundCode: round.code,
          prizeCents: recalculated, idempotencyKey, reason: parsed.data.reason,
          originalResultAt: round.resultAt.toISOString(), originalPurchaseCreatedAt: purchase.createdAt.toISOString(), creditedNow },
      } });
      return { player: purchase.player.username, roundCode: round.code, prizeCents: recalculated, creditedNow };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ success: true, ...result }, { headers });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "O crédito já existe; atualize a lista para reconciliar o registro." }, { status: 409, headers });
    const code = error instanceof Error ? error.message : "";
    if (code === "LINE_NOT_FOUND") return NextResponse.json({ error: "Prêmio não encontrado." }, { status: 404, headers });
    if (code === "NOT_ELIGIBLE") return NextResponse.json({ error: "Este registro não é elegível para crédito corretivo de prêmio online." }, { status: 409, headers });
    if (code === "NO_PRIZE") return NextResponse.json({ error: "A linha não possui prêmio positivo apurado." }, { status: 409, headers });
    if (code === "ALREADY_PAID") return NextResponse.json({ error: "Este prêmio já possui pagamento registrado por Pix ou dinheiro; o crédito corretivo foi bloqueado." }, { status: 409, headers });
    if (code === "PRIZE_MISMATCH" || code === "LEDGER_CONFLICT") return NextResponse.json({ error: "Divergência financeira detectada. O crédito foi bloqueado para auditoria." }, { status: 409, headers });
    return NextResponse.json({ error: "Não foi possível realizar a correção do crédito." }, { status: 500, headers });
  }
}
