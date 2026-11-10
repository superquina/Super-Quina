import { NextRequest, NextResponse } from "next/server";
import { authPrisma, getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "É necessário entrar na conta." }, { status: 401, headers });
  if (user.role !== "ADMIN" || user.mustChangePassword) return NextResponse.json({ error: "Acesso não permitido." }, { status: 403, headers });

  const receiptCode = (request.nextUrl.searchParams.get("q") ?? "").replace(/\s/g, "").toUpperCase();
  if (!/^SQ-[A-Z0-9]{8,32}$/.test(receiptCode)) return NextResponse.json({ error: "Informe o código completo do recibo iniciado por SQ-." }, { status: 400, headers });

  try {
    const purchase = await authPrisma.purchase.findFirst({
      where: { receiptCode, cashierId: { not: null }, playerId: null },
      select: {
        receiptCode: true, status: true, confirmedAt: true, paymentMethod: true,
        payment: { select: { status: true, confirmedAt: true } },
        participations: {
          where: { status: "CONFIRMED" },
          select: {
            round: { select: { code: true, status: true } },
            numericLines: {
              select: {
                id: true, numberValue: true, prizeCents: true, prizeCreditedAt: true,
                prizePayout: { select: { channel: true, paidAt: true } },
              },
            },
          },
        },
      },
    });
    if (!purchase) return NextResponse.json({ error: "Recibo não encontrado." }, { status: 404, headers });
    const paymentConfirmed = purchase.paymentMethod === "CASH" || purchase.paymentMethod === "WALLET"
      ? purchase.status === "CONFIRMED" && purchase.confirmedAt !== null
      : purchase.status === "CONFIRMED" && purchase.payment?.status === "CONFIRMED" && purchase.payment.confirmedAt !== null;
    if (!paymentConfirmed) return NextResponse.json({ error: "O pagamento deste recibo ainda não está confirmado." }, { status: 409, headers });

    const lines = purchase.participations.flatMap((part) => part.numericLines.map((line) => ({
      id: line.id, numberValue: line.numberValue, roundCode: part.round.code,
      roundCompleted: part.round.status === "COMPLETED",
      prizeCents: part.round.status === "COMPLETED" && (line.prizeCents ?? 0) > 0 ? line.prizeCents : 0,
      paid: Boolean(line.prizeCreditedAt || line.prizePayout),
      payoutChannel: line.prizePayout?.channel ?? (line.prizeCreditedAt ? "WALLET" : null),
      paidAt: line.prizePayout?.paidAt.toISOString() ?? null,
    })));
    return NextResponse.json({ receiptCode: purchase.receiptCode, lines }, { headers });
  } catch {
    return NextResponse.json({ error: "Não foi possível consultar o recibo agora." }, { status: 500, headers });
  }
}
