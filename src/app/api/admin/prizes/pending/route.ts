import { NextRequest, NextResponse } from "next/server";
import { authPrisma, getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";
import { getNumericPrizeReview, NUMERIC_PRIZE_CATEGORY_LABELS } from "@/domain/numeric-prize-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "É necessário entrar na conta." }, { status: 401 });
  if (user.role !== "ADMIN" || user.mustChangePassword) {
    return NextResponse.json({ error: "Acesso não permitido." }, { status: 403 });
  }

  try {
    const lines = await authPrisma.numericParticipationLine.findMany({
      where: {
        prizeCents: { gt: 0 },
        participation: {
          is: {
            status: "CONFIRMED",
            round: { is: { status: "COMPLETED" } },
            purchase: { is: { status: "CONFIRMED" } },
          },
        },
      },
      select: {
        id: true, numberValue: true, unitCents: true, tensCents: true,
        hundredsCents: true, thousandsCents: true, quinaCents: true,
        ruleVersion: true, ruleSnapshot: true, prizeCents: true, prizeCreditedAt: true,
        prizePayout: { select: { channel: true, paidAt: true, reference: true } },
        participation: {
          select: {
            totalCents: true,
            round: { select: { code: true, resultNumber: true, resultAt: true } },
            purchase: {
              select: {
                totalCents: true, receiptCode: true, playerId: true, cashierId: true,
                player: { select: { username: true, fullName: true } },
                customer: { select: { name: true, phone: true } },
                cashier: { select: { username: true, fullName: true } },
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    return NextResponse.json({
      winners: lines.map((line) => {
        const round = line.participation.round;
        const review = getNumericPrizeReview({
          numberValue: line.numberValue,
          unitCents: line.unitCents, tensCents: line.tensCents,
          hundredsCents: line.hundredsCents, thousandsCents: line.thousandsCents,
          quinaCents: line.quinaCents, ruleVersion: line.ruleVersion,
          ruleSnapshot: line.ruleSnapshot,
        }, round.resultNumber);
        return {
          id: line.id,
          numberValue: line.numberValue,
          stakeCents: line.unitCents + line.tensCents + line.hundredsCents + line.thousandsCents + line.quinaCents,
          prizeCategory: review?.category ?? null,
          prizeCategoryLabel: review ? NUMERIC_PRIZE_CATEGORY_LABELS[review.category] : null,
          categoryStakeCents: review?.stakeCents ?? null,
          multiplier: review?.multiplier ?? null,
          calculatedPrizeCents: review?.calculatedPrizeCents ?? null,
          calculationConsistent: Boolean(review?.calculationConsistent && review.calculatedPrizeCents === line.prizeCents),
          prizeCents: line.prizeCents ?? 0,
          roundCode: round.code,
          resultNumber: round.resultNumber,
          resultAt: round.resultAt.toISOString(),
          participationTotalCents: line.participation.totalCents,
          purchaseTotalCents: line.participation.purchase.totalCents,
          receiptCode: line.participation.purchase.receiptCode,
          playerName: line.participation.purchase.player?.fullName
            ?? line.participation.purchase.player?.username
            ?? line.participation.purchase.customer?.name
            ?? "Cliente sem nome cadastrado",
          phone: line.participation.purchase.customer?.phone ?? null,
          cashierName: line.participation.purchase.cashier?.fullName
            ?? line.participation.purchase.cashier?.username ?? null,
          manualEligible: Boolean(line.participation.purchase.cashierId && !line.participation.purchase.playerId),
          paid: Boolean(line.prizePayout || line.prizeCreditedAt),
          payoutChannel: line.prizePayout?.channel ?? (line.prizeCreditedAt ? "WALLET" : null),
          paidAt: line.prizePayout?.paidAt.toISOString() ?? line.prizeCreditedAt?.toISOString() ?? null,
          reference: line.prizePayout?.reference ?? null,
        };
      }),
    }, { headers: { "Cache-Control": "no-store, private" } });
  } catch {
    return NextResponse.json({ error: "Não foi possível carregar a lista de ganhadores." }, {
      status: 500, headers: { "Cache-Control": "no-store" },
    });
  }
}
