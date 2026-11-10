import { NextRequest, NextResponse } from "next/server";
import { authPrisma } from "@/lib/auth/session";
import { calculateNumberPrizeCents } from "@/modules/numbers/calculate-number-prize";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
type RouteContext = { params: Promise<{ receiptCode: string }> };
export async function GET(_request: NextRequest, context: RouteContext) {
  const { receiptCode: rawCode } = await context.params;
  const receiptCode = rawCode.replace(/\s/g, "").toUpperCase();
  if (!/^SQ-[A-Z0-9]{8,32}$/.test(receiptCode)) return NextResponse.json({ valid: false, message: "Código de recibo inválido." }, { status: 400, headers });
  try {
    const purchase = await authPrisma.purchase.findUnique({
      where: { receiptCode },
      select: {
        receiptCode: true, status: true, paymentMethod: true, totalCents: true, currency: true, confirmedAt: true, cashierId: true, playerId: true,
        payment: { select: { status: true, confirmedAt: true } },
        participations: {
          where: { status: "CONFIRMED" }, orderBy: { round: { resultAt: "asc" } },
          select: {
            round: { select: { code: true, status: true, resultNumber: true, startsAt: true, resultAt: true } },
            numericLines: {
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: { numberValue: true, unitCents: true, tensCents: true, hundredsCents: true, thousandsCents: true, quinaCents: true, ruleVersion: true, ruleSnapshot: true, prizeCents: true, prizeCreditedAt: true, prizePayout: { select: { channel: true, paidAt: true } } },
            },
          },
        },
      },
    });
    if (!purchase) return NextResponse.json({ valid: false, message: "Este código não corresponde a um recibo registrado na Super Quina." }, { status: 404, headers });
    const paymentConfirmed = purchase.paymentMethod === "CASH" || purchase.paymentMethod === "WALLET"
      ? purchase.status === "CONFIRMED" && purchase.confirmedAt !== null
      : purchase.status === "CONFIRMED" && purchase.payment?.status === "CONFIRMED" && purchase.payment.confirmedAt !== null;
    if (!paymentConfirmed) return NextResponse.json({
      valid: false, receiptCode: purchase.receiptCode,
      message: "O registro existe, mas o pagamento não está confirmado. Não aceite este documento como recibo pago.",
    }, { headers });
    const rounds = purchase.participations.map((participation) => {
      const round = participation.round;
      const completed = round.status === "COMPLETED" && Boolean(round.resultNumber);
      const now = Date.now();
      const status = round.status === "CANCELLED" ? "RODADA_CANCELADA" : completed ? "RESULTADO_PUBLICADO"
        : now < round.resultAt.getTime() ? "SORTEIO_AGUARDANDO" : "AGUARDANDO_RESULTADO_OFICIAL";
      const numbers = participation.numericLines.map((line) => {
        let calculated: number | null = null;
        if (completed && round.resultNumber) {
          try {
            calculated = calculateNumberPrizeCents({
              numberValue: line.numberValue, unitCents: line.unitCents, tensCents: line.tensCents,
              hundredsCents: line.hundredsCents, thousandsCents: line.thousandsCents,
              quinaCents: line.quinaCents, ruleVersion: line.ruleVersion, ruleSnapshot: line.ruleSnapshot,
            }, round.resultNumber);
          } catch { /* Never guess if saved rules are inconsistent. */ }
        }
        const prize = line.prizeCents ?? calculated;
        return { numberValue: line.numberValue,
          resultStatus: !completed ? "AGUARDANDO" : prize !== null ? prize > 0 ? "PREMIADA" : "NAO_PREMIADA" : "AGUARDANDO_APURACAO",
          prizeCents: completed && prize !== null && prize > 0 ? prize : null, prizePaid: Boolean(line.prizeCreditedAt || line.prizePayout), payoutChannel: line.prizePayout?.channel ?? null, paidAt: line.prizePayout?.paidAt.toISOString() ?? null };
      });
      return { roundCode: round.code, status, startsAt: round.startsAt.toISOString(), resultAt: round.resultAt.toISOString(),
        resultNumber: completed ? round.resultNumber : null, numbers };
    });
    return NextResponse.json({ valid: true, receiptCode: purchase.receiptCode, status: "CONFIRMED",
      paymentMethod: purchase.paymentMethod, totalCents: purchase.totalCents, currency: purchase.currency,
      manualPayoutEligible: Boolean(purchase.cashierId && !purchase.playerId),
      confirmedAt: purchase.confirmedAt?.toISOString() ?? null,
      rounds,
      message: "Recibo registrado e pagamento confirmado no sistema oficial." }, { headers });
  } catch {
    return NextResponse.json({ valid: false, message: "Não foi possível verificar agora. Tente novamente." }, { status: 500, headers });
  }
}
