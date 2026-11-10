import { NextRequest, NextResponse } from "next/server";
import { authPrisma, getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "É necessário entrar na conta." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if ((user.role !== "PLAYER" && user.role !== "CASHIER" && user.role !== "ADMIN") || user.mustChangePassword) return NextResponse.json({ error: "Acesso não permitido." }, { status: 403, headers: { "Cache-Control": "no-store" } });

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rounds = await authPrisma.round.findMany({
      where: { status: "COMPLETED", resultAt: { gte: since }, resultNumber: { not: null } },
      select: { id: true, code: true, resultAt: true, resultNumber: true },
      orderBy: { resultAt: "desc" }, take: 50,
    });
    return NextResponse.json({ results: rounds.map((round) => ({
      id: round.id, code: round.code, resultAt: round.resultAt.toISOString(),
      number: round.resultNumber!,
    })) }, { headers: { "Cache-Control": "no-store, private" } });
  } catch {
    return NextResponse.json({ error: "Não foi possível carregar os resultados agora." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
