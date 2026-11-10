import { NextRequest, NextResponse } from "next/server";
import { authPrisma, getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: "É necessário entrar na conta." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if ((user.role !== "PLAYER" && user.role !== "CASHIER") || user.mustChangePassword) {
    return NextResponse.json({ error: "Acesso não permitido." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const now = new Date();
  const rounds = await authPrisma.round.findMany({
    where: {
      status: { in: ["SCHEDULED", "OPEN"] },
      cutoffAt: { gt: now },
    },
    select: { id: true, code: true, startsAt: true, cutoffAt: true, resultAt: true, status: true },
    orderBy: [{ startsAt: "asc" }, { code: "asc" }],
    take: 10,
  });

  return NextResponse.json({
    rounds: rounds.map((round) => ({
      id: round.id,
      code: round.code,
      startsAt: round.startsAt.toISOString(),
      cutoffAt: round.cutoffAt.toISOString(),
      resultAt: round.resultAt.toISOString(),
      status: round.status,
    })),
  }, { headers: { "Cache-Control": "no-store, private" } });
}
