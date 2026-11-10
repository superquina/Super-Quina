import { NextRequest, NextResponse } from "next/server";
import { authPrisma, getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "É necessário entrar na conta." }, { status: 401, headers });
  if (user.role !== "CASHIER" || user.mustChangePassword) return NextResponse.json({ error: "Acesso não permitido." }, { status: 403, headers });

  try {
    const lastSettlement = await authPrisma.cashierSettlement.findFirst({
      where: { cashierId: user.id }, orderBy: { settledAt: "desc" },
      select: { settledAt: true },
    });
    const since = lastSettlement?.settledAt ?? new Date(0);
    const common = { cashierId: user.id, status: "CONFIRMED" as const, confirmedAt: { gt: since } };
    const [cash, pix, commission, profile, games, cashPrizePayouts] = await Promise.all([
      authPrisma.purchase.aggregate({
        where: { ...common, paymentMethod: "CASH" },
        _sum: { totalCents: true },
      }),
      authPrisma.purchase.aggregate({
        where: { ...common, paymentMethod: "PIX", payment: { is: { status: "CONFIRMED" } } },
        _sum: { totalCents: true },
      }),
      authPrisma.cashierCommission.aggregate({
        where: { cashierId: user.id, purchase: { is: { status: "CONFIRMED", confirmedAt: { gt: since } } } },
        _sum: { amountCents: true },
      }),
      authPrisma.user.findUnique({ where: { id: user.id }, select: { commissionRateBasisPoints: true } }),
      authPrisma.numericParticipationLine.count({ where: { participation: { is: { status: "CONFIRMED", purchase: { is: { cashierId: user.id, status: "CONFIRMED", confirmedAt: { gt: since } } } } } } }),
      authPrisma.numericPrizePayout.aggregate({ where: { cashierId: user.id, channel: "CASHIER_CASH", paidAt: { gt: since }, settlementId: null }, _sum: { amountCents: true }, _count: { _all: true } }),
    ]);
    const cashSalesCents = cash._sum.totalCents ?? 0;
    const pixSalesCents = pix._sum.totalCents ?? 0;
    return NextResponse.json({
      cashSalesCents, pixSalesCents, totalSalesCents: cashSalesCents + pixSalesCents,
      gamesCount: games,
      cashPrizePayoutCents: cashPrizePayouts._sum.amountCents ?? 0,
      cashPrizePayoutCount: cashPrizePayouts._count._all,
      commissionCents: commission._sum.amountCents ?? 0,
      commissionRateBasisPoints: profile?.commissionRateBasisPoints ?? 0,
      lastSettlementAt: lastSettlement?.settledAt.toISOString() ?? null,
    }, { headers });
  } catch {
    return NextResponse.json({ error: "Não foi possível carregar o resumo financeiro." }, { status: 500, headers });
  }
}
