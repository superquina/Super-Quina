import { NextRequest, NextResponse } from "next/server";
import { authPrisma } from "@/lib/auth/session";
import type { RoundStatus } from "@/generated/prisma/client";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, public, max-age=0" };

function getLineStatus(line: { prizeCents: number | null; prizeCreditedAt: Date | null; prizePayout: { channel: string } | null },
  round: { status: RoundStatus; resultAt: Date }, manualClaimDeadlineApplies: boolean) {
  if (line.prizeCents !== null && line.prizeCents > 0 && (line.prizeCreditedAt || line.prizePayout)) return "PREMIADA";
  if (manualClaimDeadlineApplies && (line.prizeCents ?? 0) > 0 && Date.now() >= round.resultAt.getTime() + 7 * 86400000) return "PRAZO_EXPIRADO";
  if (round.status !== "COMPLETED") return "AGUARDANDO_RESULTADO";
  if (line.prizeCents === 0) return "NAO_PREMIADA";
  return "AGUARDANDO_APURACAO";
}

export async function GET(request: NextRequest) {
  const normalizedCode = (request.nextUrl.searchParams.get("q") ?? "").replace(/\s/g, "").toUpperCase();
  if (!/^SQ-[A-Z0-9]{8,32}$/.test(normalizedCode)) return NextResponse.json({ error: "Digite o código completo do recibo iniciado por SQ-." }, { status: 400, headers });
  try {
    const purchase = await authPrisma.purchase.findUnique({
      where: { receiptCode: normalizedCode },
      select: {
        status: true, playerId: true, createdAt: true,
        participations: {
          where: { status: "CONFIRMED" },
          select: {
            round: { select: { code: true, status: true, resultAt: true, resultNumber: true } },
            numericLines: { select: { id: true, numberValue: true, prizeCents: true, prizeCreditedAt: true, prizePayout: { select: { channel: true, paidAt: true } } } },
          },
          orderBy: { round: { resultAt: "desc" } },
        },
      },
    });
    if (!purchase || purchase.status !== "CONFIRMED") return NextResponse.json({ found: false, results: [], message: "Não encontramos um recibo confirmado com esse código. Confira e tente novamente." }, { headers });
    if (Date.now() >= purchase.createdAt.getTime() + 7 * 86400000) return NextResponse.json({ found: false, results: [], message: "O prazo de validade de 7 dias deste recibo terminou. A consulta pública não está mais disponível." }, { headers });
    const results = purchase.participations.flatMap((part) => part.numericLines.map((line) => ({
      id: line.id, numberValue: line.numberValue,
      roundCode: part.round.code, resultAt: part.round.resultAt.toISOString(),
      roundStatus: part.round.status, resultNumber: part.round.resultNumber,
      status: getLineStatus(line, part.round, purchase.playerId === null),
      prizeCents: (line.prizeCreditedAt || line.prizePayout) && (line.prizeCents ?? 0) > 0 ? line.prizeCents : null,
      payoutChannel: line.prizePayout?.channel ?? null,
      paidAt: line.prizePayout?.paidAt.toISOString() ?? null,
    })));
    return NextResponse.json({ found: true, searchType: "RECIBO", results,
      message: results.length ? "Confira abaixo cada número e seu resultado." : "Este recibo não possui apostas numéricas confirmadas para consulta." }, { headers });
  } catch {
    return NextResponse.json({ error: "Não foi possível consultar agora. Tente novamente." }, { status: 500, headers });
  }
}
