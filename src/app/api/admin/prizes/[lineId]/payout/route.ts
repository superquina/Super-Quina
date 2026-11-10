import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { authPrisma, getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";
import { NumericPrizePayoutError, registerNumericPrizePayout } from "@/modules/rounds/register-numeric-prize-payout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
const bodySchema = z.object({ reference: z.string().trim().max(300).optional() }).strict();

function validOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host")?.trim().toLowerCase();
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.host.toLowerCase() === host;
  } catch { return false; }
}

export async function POST(request: NextRequest, context: { params: Promise<{ lineId: string }> }) {
  if (!validOrigin(request)) return NextResponse.json({ error: "Requisição inválida." }, { status: 403, headers });
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "É necessário entrar na conta." }, { status: 401, headers });
  if (user.role !== "ADMIN" || user.mustChangePassword) return NextResponse.json({ error: "Somente o administrador pode registrar pagamento de prêmio." }, { status: 403, headers });
  const { lineId } = await context.params;
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(lineId)) return NextResponse.json({ error: "Prêmio não encontrado." }, { status: 404, headers });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400, headers }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Referência inválida." }, { status: 400, headers });
  try {
    const payout = await authPrisma.$transaction((tx) => registerNumericPrizePayout(tx, {
      lineId, actorId: user.id, channel: "PLATFORM_PIX", reference: parsed.data.reference,
    }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ payout }, { status: 201, headers });
  } catch (error) {
    if (error instanceof NumericPrizePayoutError) {
      if (error.code === "LINE_NOT_FOUND") return NextResponse.json({ error: "Prêmio não encontrado." }, { status: 404, headers });
      if (error.code === "ALREADY_PAID") return NextResponse.json({ error: "Este prêmio já foi pago por um dos canais." }, { status: 409, headers });
      if (error.code === "INCONSISTENT_PRIZE") return NextResponse.json({ error: "Pagamento bloqueado: o prêmio registrado não confere com o número sorteado, a categoria, o valor apostado e o multiplicador salvo. Solicite conferência da administração." }, { status: 409, headers });
      return NextResponse.json({ error: "Este prêmio ainda não está disponível para pagamento." }, { status: 409, headers });
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "Este prêmio já foi pago por um dos canais." }, { status: 409, headers });
    }
    return NextResponse.json({ error: "Não foi possível registrar o pagamento Pix." }, { status: 500, headers });
  }
}
