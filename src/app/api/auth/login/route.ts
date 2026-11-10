import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyPassword } from "@/lib/auth/password";
import { authPrisma, createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { clearLoginFailures, getLoginBlock, recordLoginFailure } from "@/lib/auth/login-rate-limit";

export const runtime = "nodejs";
const schema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(1024),
}).strict();

function secureCookie(request: NextRequest) {
  return request.nextUrl.protocol === "https:" || process.env.NODE_ENV === "production";
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return NextResponse.json({ error: "Requisição inválida." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return NextResponse.json({ error: "Requisição inválida." }, { status: 403 });
    }

    // Compare the browser Origin with the incoming Host to reject cross-origin requests.
    const requestHost = request.headers.get("host");
    if (!requestHost || originHost !== requestHost) {
      return NextResponse.json({ error: "Requisição inválida." }, { status: 403 });
    }
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });

  const blocked = await getLoginBlock(authPrisma, parsed.data.username);
  if (blocked) {
    const limited = NextResponse.json({ error: "Muitas tentativas. Aguarde antes de tentar novamente." }, { status: 429 });
    limited.headers.set("Retry-After", String(blocked.retryAfterSeconds));
    limited.headers.set("Cache-Control", "no-store");
    return limited;
  }

  const user = await authPrisma.user.findUnique({
    where: { username: parsed.data.username },
    select: { id: true, passwordHash: true, status: true },
  });
  const validPassword = await verifyPassword(parsed.data.password, user?.passwordHash ?? "");
  if (!user || user.status !== "ACTIVE" || !validPassword) {
    const failure = await recordLoginFailure(authPrisma, parsed.data.username);
    if (failure.blocked) {
      const limited = NextResponse.json({ error: "Muitas tentativas. Aguarde antes de tentar novamente." }, { status: 429 });
      limited.headers.set("Retry-After", String(failure.retryAfterSeconds));
      limited.headers.set("Cache-Control", "no-store");
      return limited;
    }
    return NextResponse.json({ error: "Usuário ou senha inválidos." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  await clearLoginFailures(authPrisma, parsed.data.username);
  const { token, expiresAt } = await createSession(user.id);
  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: secureCookie(request), sameSite: "lax", path: "/", expires: expiresAt,
  });
  return response;
}
