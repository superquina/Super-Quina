import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { authPrisma, getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";
import { calculateCommissionCents } from "@/domain/cashier-commission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };

function validOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.host.toLowerCase() === request.headers.get("host")?.trim().toLowerCase();
  } catch { return false; }
}

export async function POST(request: NextRequest, context: { params: Promise<{ cashierId: string }> }) {
  if (!validOrigin(request)) return NextResponse.json({ error: "Requisição inválida." }, { status: 403, headers });
  const admin = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!admin) return NextResponse.json({ error: "É necessário entrar na conta." }, { status: 401, headers });
  if (admin.role !== "ADMIN" || admin.mustChangePassword) return NextResponse.json({ error: "Somente o administrador pode registrar um acerto." }, { status: 403, headers });
  const { cashierId } = await context.params;
  try {
    const settlement = await authPrisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${cashierId} AND "role" = 'CASHIER' FOR UPDATE`;
      const cashier = await tx.user.findFirst({ where: { id: cashierId, role: "CASHIER" }, select: { id: true } });
      if (!cashier) throw new Error("CASHIER_NOT_FOUND");
      const last = await tx.cashierSettlement.findFirst({ where: { cashierId }, orderBy: { settledAt: "desc" }, select: { settledAt: true } });
      const since = last?.settledAt ?? new Date(0);
      const settledAt = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      const cutoff = settledAt[0]!.now;
      const eligible = { cashierId, status: "CONFIRMED" as const, confirmedAt: { gt: since, lte: cutoff } };
      const [cash, pix, commissions, games, cashPrizePayouts, eligibleSales] = await Promise.all([
        tx.purchase.aggregate({ where: { ...eligible, paymentMethod: "CASH" }, _sum: { totalCents: true }, _count: { _all: true } }),
        tx.purchase.aggregate({ where: { ...eligible, paymentMethod: "PIX", payment: { is: { status: "CONFIRMED" } } }, _sum: { totalCents: true }, _count: { _all: true } }),
        tx.cashierCommission.aggregate({
          where: {
            cashierId,
            purchase: {
              is: {
                ...eligible,
                OR: [
                  { paymentMethod: "CASH" },
                  { paymentMethod: "PIX", payment: { is: { status: "CONFIRMED" } } },
                ],
              },
            },
          },
          _sum: { amountCents: true },
        }),
        tx.numericParticipationLine.count({ where: { participation: { is: { status: "CONFIRMED", purchase: { is: { cashierId, status: "CONFIRMED", confirmedAt: { gt: since, lte: cutoff } } } } } } }),
        tx.numericPrizePayout.aggregate({ where: { cashierId, channel: "CASHIER_CASH", settlementId: null, paidAt: { gt: since, lte: cutoff } }, _sum: { amountCents: true }, _count: { _all: true } }),
        tx.purchase.findMany({
          where: { ...eligible, OR: [
            { paymentMethod: "CASH" },
            { paymentMethod: "PIX", payment: { is: { status: "CONFIRMED" } } },
          ] },
          select: { id: true, totalCents: true, commission: { select: { cashierId: true, rateBasisPoints: true, amountCents: true } } },
        }),
      ]);
      const commissionsAreConsistent = eligibleSales.every((sale) => {
        const commission = sale.commission;
        if (!commission || commission.cashierId !== cashierId) return false;
        try {
          return commission.amountCents === calculateCommissionCents(sale.totalCents, commission.rateBasisPoints);
        } catch { return false; }
      });
      if (!commissionsAreConsistent) throw new Error("CASHIER_COMMISSION_INTEGRITY_ERROR");
      const cashSalesCents = cash._sum.totalCents ?? 0;
      const pixSalesCents = pix._sum.totalCents ?? 0;
      const snapshot = await tx.cashierSettlement.create({ data: {
        cashierId, adminId: admin.id, settledAt: cutoff,
        cashSalesCents, pixSalesCents, totalSalesCents: cashSalesCents + pixSalesCents,
        salesCount: cash._count._all + pix._count._all, gamesCount: games,
        commissionCents: commissions._sum.amountCents ?? 0,
        cashPrizePayoutCount: cashPrizePayouts._count._all,
        cashPrizePayoutCents: cashPrizePayouts._sum.amountCents ?? 0,
      } });
      await tx.numericPrizePayout.updateMany({ where: { cashierId, channel: "CASHIER_CASH", settlementId: null, paidAt: { gt: since, lte: cutoff } }, data: { settlementId: snapshot.id } });
      await tx.auditEvent.create({ data: {
        actorId: admin.id, action: "CASHIER_SETTLEMENT_RECORDED", entityType: "CashierSettlement", entityId: snapshot.id,
        metadata: { cashierId, cashSalesCents, pixSalesCents, totalSalesCents: snapshot.totalSalesCents, salesCount: snapshot.salesCount, gamesCount: snapshot.gamesCount, commissionCents: snapshot.commissionCents, cashPrizePayoutCount: snapshot.cashPrizePayoutCount, cashPrizePayoutCents: snapshot.cashPrizePayoutCents, settledAt: snapshot.settledAt.toISOString() },
      } });
      return snapshot;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ settlement }, { status: 201, headers });
  } catch (error) {
    if (error instanceof Error && error.message === "CASHIER_NOT_FOUND") return NextResponse.json({ error: "Cambista não encontrado." }, { status: 404, headers });
    if (error instanceof Error && error.message === "CASHIER_COMMISSION_INTEGRITY_ERROR") return NextResponse.json({ error: "Acerto bloqueado: existe venda confirmada sem comissão ou com comissão inconsistente. Corrija os dados antes de fechar." }, { status: 409, headers });
    return NextResponse.json({ error: "Não foi possível registrar o acerto. Atualize a página e tente novamente." }, { status: 500, headers });
  }
}
