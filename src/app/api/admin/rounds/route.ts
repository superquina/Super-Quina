import { NextRequest, NextResponse } from "next/server";
import { authPrisma, getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: "É necessário entrar na conta." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (user.role !== "ADMIN" || user.mustChangePassword) {
    return NextResponse.json({ error: "Acesso não permitido." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const [rounds, pendingPayments, confirmedPurchases] = await Promise.all([
      authPrisma.round.findMany({
        select: {
          id: true, code: true, startsAt: true, cutoffAt: true, resultAt: true, status: true,
          resultNumber: true,
          _count: { select: { participations: true } },
        },
        orderBy: [{ startsAt: "desc" }, { code: "desc" }],
        take: 100,
      }),
      authPrisma.purchase.count({ where: { status: "PENDING_PAYMENT" } }),
      authPrisma.purchase.count({ where: { status: "CONFIRMED" } }),
    ]);
    return NextResponse.json({
      rounds: rounds.map((round) => ({
        id: round.id, code: round.code, startsAt: round.startsAt.toISOString(),
        cutoffAt: round.cutoffAt.toISOString(), resultAt: round.resultAt.toISOString(),
        status: round.status, resultNumber: round.resultNumber,
        participationCount: round._count.participations,
      })),
      summary: { pendingPayments, confirmedPurchases },
    }, { headers: { "Cache-Control": "no-store, private" } });
  } catch {
    return NextResponse.json({ error: "Não foi possível carregar o painel administrativo." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

