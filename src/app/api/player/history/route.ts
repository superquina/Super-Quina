import { NextRequest, NextResponse } from "next/server";
import { authPrisma, getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type ResultStatus = "PREMIADA" | "NAO_PREMIADA" | "AGUARDANDO_RESULTADO" | "AGUARDANDO_APURACAO" | "COMPRA_PENDENTE";
function lineStatus(purchaseStatus: string, participationStatus: string, roundStatus: string, prizeCents: number | null, prizeCreditedAt: Date | null, resultPublished: boolean): ResultStatus {
  if (purchaseStatus !== "CONFIRMED" || participationStatus !== "CONFIRMED") return "COMPRA_PENDENTE";
  if (prizeCreditedAt !== null && (prizeCents ?? 0) > 0) return "PREMIADA";
  if (roundStatus !== "COMPLETED" || !resultPublished) return "AGUARDANDO_RESULTADO";
  if (prizeCents === 0) return "NAO_PREMIADA";
  return "AGUARDANDO_APURACAO";
}
export async function GET(request: NextRequest) {
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  const headers = { "Cache-Control": "no-store, private" };
  if (!user) return NextResponse.json({ error: "É necessário entrar na conta." }, { status: 401, headers });
  if (user.role !== "PLAYER" || user.mustChangePassword) return NextResponse.json({ error: "Acesso não permitido." }, { status: 403, headers });
  try {
    const since = new Date(Date.now() - 7 * 86400000);
    const purchases = await authPrisma.purchase.findMany({
      where: { playerId: user.id, createdAt: { gte: since } },
      select: {
        id: true, status: true, createdAt: true, totalCents: true,
        participations: {
          select: {
            id: true, status: true, totalCents: true,
            round: { select: { code: true, status: true, resultAt: true, resultNumber: true } },
            numericLines: { select: { id: true, numberValue: true, prizeCents: true, prizeCreditedAt: true } },
          },
          orderBy: { round: { resultAt: "desc" } },
        },
      },
      orderBy: { createdAt: "desc" }, take: 100,
    });
    const history = purchases.map((purchase) => ({
      id: purchase.id, purchaseStatus: purchase.status, createdAt: purchase.createdAt.toISOString(), totalCents: purchase.totalCents,
      participations: purchase.participations.map((part) => ({
        id: part.id, status: part.status, totalCents: part.totalCents, roundCode: part.round.code,
        roundStatus: part.round.status, resultAt: part.round.resultAt.toISOString(),
        resultNumber: part.round.resultNumber,
        lines: part.numericLines.map((line) => ({
          id: line.id, numberValue: line.numberValue,
          resultStatus: lineStatus(purchase.status, part.status, part.round.status, line.prizeCents, line.prizeCreditedAt, Boolean(part.round.resultNumber)),
          prizeCents: line.prizeCreditedAt && (line.prizeCents ?? 0) > 0 ? line.prizeCents : null,
        })),
      })),
    }));
    return NextResponse.json({ history }, { headers });
  } catch {
    return NextResponse.json({ error: "Não foi possível carregar seu histórico agora." }, { status: 500, headers });
  }
}
