import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, authPrisma, SESSION_COOKIE } from "@/lib/auth/session";
import { RoundSettlementError } from "@/modules/rounds/round-settlement-error";
import { settleNumericRoundPrizes } from "@/modules/rounds/settle-numeric-round-prizes";

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
  if (user.mustChangePassword) return response({ error: "Altere a senha inicial antes de continuar." }, 403);
  if (user.role !== "ADMIN") {
    await authPrisma.auditEvent.create({
      data: { actorId: user.id, action: "ROUND_SETTLEMENT_DENIED", entityType: "Round", metadata: { reason: "insufficient_role" } },
    });
    return response({ error: "Permissão insuficiente." }, 403);
  }

  const params = await context.params;
  const parsedId = roundIdSchema.safeParse(params.roundId);
  if (!parsedId.success) return response({ error: "Identificador de rodada inválido." }, 400);

  try {
    const result = await settleNumericRoundPrizes(authPrisma, parsedId.data, user.id);
    return response({ settled: true, result }, 200);
  } catch (error) {
    if (error instanceof RoundSettlementError) {
      if (error.code === "ROUND_NOT_FOUND") return response({ error: "Rodada não encontrada." }, 404);
      if (error.code === "ROUND_NOT_DRAWN") return response({ error: "O resultado oficial precisa estar publicado antes da apuração." }, 409);
      if (error.code === "INVALID_RULE_SNAPSHOT") return response({ error: "Aposta sem multiplicadores históricos válidos; apuração bloqueada para reconciliação." }, 409);
      if (error.code === "INCONSISTENT_SETTLEMENT") return response({ error: "A apuração encontrou dados financeiros inconsistentes; é necessária reconciliação." }, 409);
    }
    return response({ error: "Não foi possível concluir a apuração." }, 500);
  }
}
