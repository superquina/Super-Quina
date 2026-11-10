import { NextRequest, NextResponse } from "next/server";
import { authPrisma, getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";
import { getNumericPrizeReview, NUMERIC_PRIZE_CATEGORY_LABELS } from "@/domain/numeric-prize-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "É necessário entrar na conta." }, { status: 401, headers });
  if (user.role !== "CASHIER" || user.mustChangePassword) return NextResponse.json({ error: "Acesso não permitido." }, { status: 403, headers });

  const receiptCode = (request.nextUrl.searchParams.get("q") ?? "").replace(/\s/g, "").toUpperCase();
  if (!/^SQ-[A-Z0-9]{8,32}$/.test(receiptCode)) return NextResponse.json({ error: "Informe o código completo do recibo iniciado por SQ-." }, { status: 400, headers });

  try {
    const purchase = await authPrisma.purchase.findFirst({
      where: { receiptCode, cashierId: user.id, playerId: null, status: "CONFIRMED", confirmedAt: { not: null } },
      select: {
        receiptCode: true, totalCents: true,
        participations: {
          where: { status: "CONFIRMED" },
          select: {
            totalCents: true,
            round: { select: { code: true, status: true, resultNumber: true, resultAt: true } },
            numericLines: {
              select: {
                id: true, numberValue: true, unitCents: true, tensCents: true,
                hundredsCents: true, thousandsCents: true, quinaCents: true,
                ruleVersion: true, ruleSnapshot: true, prizeCents: true, prizeCreditedAt: true,
                prizePayout: { select: { channel: true, amountCents: true, paidAt: true } },
              },
            },
          },
        },
      },
    });
    if (!purchase) return NextResponse.json({ error: "Recibo não encontrado ou não pertence ao seu ponto de venda." }, { status: 404, headers });

    const lines = purchase.participations.flatMap((participation) => participation.numericLines.map((line) => {
      const round = participation.round;
      const review = round.status === "COMPLETED" ? getNumericPrizeReview({
        numberValue: line.numberValue,
        unitCents: line.unitCents, tensCents: line.tensCents,
        hundredsCents: line.hundredsCents, thousandsCents: line.thousandsCents,
        quinaCents: line.quinaCents, ruleVersion: line.ruleVersion,
        ruleSnapshot: line.ruleSnapshot,
      }, round.resultNumber) : null;
      const prizeCents = round.status === "COMPLETED" ? (line.prizeCents ?? 0) : 0;
      return {
        id: line.id,
        numberValue: line.numberValue,
        stakeCents: line.unitCents + line.tensCents + line.hundredsCents + line.thousandsCents + line.quinaCents,
        prizeCategory: review?.category ?? null,
        prizeCategoryLabel: review ? NUMERIC_PRIZE_CATEGORY_LABELS[review.category] : null,
        categoryStakeCents: review?.stakeCents ?? null,
        multiplier: review?.multiplier ?? null,
        calculatedPrizeCents: review?.calculatedPrizeCents ?? null,
        calculationConsistent: prizeCents > 0 && Boolean(review?.calculationConsistent && review.calculatedPrizeCents === prizeCents),
        roundCode: round.code,
        roundCompleted: round.status === "COMPLETED",
        resultNumber: round.resultNumber,
        resultAt: round.resultAt.toISOString(),
        participationTotalCents: participation.totalCents,
        purchaseTotalCents: purchase.totalCents,
        prizeCents,
        paid: Boolean(line.prizeCreditedAt || line.prizePayout),
        payoutChannel: line.prizePayout?.channel ?? (line.prizeCreditedAt ? "WALLET" : null),
        paidAt: line.prizePayout?.paidAt.toISOString() ?? null,
      };
    }));
    return NextResponse.json({ receiptCode: purchase.receiptCode, purchaseTotalCents: purchase.totalCents, lines }, { headers });
  } catch {
    return NextResponse.json({ error: "Não foi possível consultar o recibo agora." }, { status: 500, headers });
  }
}
