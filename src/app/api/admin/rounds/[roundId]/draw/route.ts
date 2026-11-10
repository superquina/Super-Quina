import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, authPrisma, SESSION_COOKIE } from "@/lib/auth/session";
import { drawRoundResults, RoundDrawError } from "@/modules/rounds/draw-round-results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const roundIdSchema = z.string().trim().min(8).max(100).regex(/^[a-zA-Z0-9_-]+$/);

function response(body: unknown, status: number) {
  const result = NextResponse.json(body, { status });
  result.headers.set("Cache-Control", "no-store");
  return result;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ roundId: string }> },
) {
  const origin = request.headers.get("origin");
  const requestHost = request.headers.get("host")?.trim().toLowerCase();
  if (!origin || !requestHost) {
    return response({ error: "Requisição inválida." }, 403);
  }

  let originHost = "";
  try {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.protocol !== "https:" && parsedOrigin.protocol !== "http:") {
      return response({ error: "Requisição inválida." }, 403);
    }
    originHost = parsedOrigin.host.toLowerCase();
  } catch {
    return response({ error: "Requisição inválida." }, 403);
  }
  if (originHost !== requestHost) {
    return response({ error: "Requisição inválida." }, 403);
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const user = await getSessionUser(token);
  if (!user) return response({ error: "Sessão inválida ou expirada." }, 401);
  if (user.mustChangePassword) {
    return response({ error: "Altere a senha inicial antes de continuar." }, 403);
  }
  if (user.role !== "ADMIN") {
    await authPrisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "ROUND_DRAW_DENIED",
        entityType: "Round",
        metadata: { reason: "insufficient_role" },
      },
    });
    return response({ error: "Permissão insuficiente." }, 403);
  }

  const params = await context.params;
  const parsedId = roundIdSchema.safeParse(params.roundId);
  if (!parsedId.success) return response({ error: "Identificador de rodada inválido." }, 400);

  try {
    const round = await drawRoundResults(authPrisma, parsedId.data, user.id);
    return response({
      drawn: true,
      round: {
        id: round.id,
        code: round.code,
        status: round.status,
        resultNumber: round.resultNumber,
      },
    }, 200);
  } catch (error) {
    if (error instanceof RoundDrawError) {
      if (error.code === "ROUND_NOT_FOUND") return response({ error: "Rodada não encontrada." }, 404);
      if (error.code === "ROUND_NOT_CLOSED") return response({ error: "A rodada precisa estar fechada antes do sorteio." }, 409);
      if (error.code === "DRAW_NOT_DUE") return response({ error: "O horário programado do resultado ainda não chegou." }, 409);
      if (error.code === "INCONSISTENT_DRAW") return response({ error: "Os resultados da rodada estão inconsistentes; é necessária reconciliação manual." }, 409);
    }
    return response({ error: "Não foi possível realizar o sorteio." }, 500);
  }
}
