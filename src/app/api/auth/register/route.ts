import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hashPassword } from "@/lib/auth/password";
import { authPrisma, createSession, SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";

const schema = z.object({
  username: z.string().trim().min(3).max(24).regex(/^[A-Za-z0-9_.-]+$/),
  password: z.string().min(6).max(1024),
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
      return NextResponse.json({ error: "Requisição inválida." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    // Compare the browser Origin with the incoming Host to reject cross-origin requests.
    const requestHost = request.headers.get("host");
    if (!requestHost || originHost !== requestHost) {
      return NextResponse.json({ error: "Requisição inválida." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Informe um usuário válido e uma senha com pelo menos 6 caracteres." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const username = parsed.data.username.toLowerCase();
  const existing = await authPrisma.user.findUnique({ where: { username }, select: { id: true } });
  if (existing) {
    return NextResponse.json({ error: "Esse usuário já está em uso. Escolha outro." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const passwordHash = await hashPassword(parsed.data.password);
    const user = await authPrisma.user.create({
      data: { username, passwordHash, role: "PLAYER", status: "ACTIVE" },
      select: { id: true },
    });
    const { token, expiresAt } = await createSession(user.id);
    const response = NextResponse.json({ created: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: secureCookie(request),
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
    return response;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "Esse usuário já está em uso. Escolha outro." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Não foi possível criar sua conta agora. Tente novamente." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
