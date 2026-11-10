import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  authPrisma,
  getSessionUser,
  hashSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "@/lib/auth/session";

export const runtime = "nodejs";
const schema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(6).max(1024),
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

    // Match the browser's Origin against the incoming Host, as the login
    // endpoint does. This avoids comparing against the internal URL that
    // Next.js may reconstruct behind Railway's reverse proxy.
    const requestHost = request.headers.get("host");
    if (!requestHost || originHost !== requestHost) {
      return NextResponse.json({ error: "Requisição inválida." }, { status: 403 });
    }
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const sessionUser = await getSessionUser(token);
  if (!sessionUser || !token) {
    return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return NextResponse.json({ error: "Escolha uma senha diferente da atual." }, { status: 400 });
  }

  const account = await authPrisma.user.findUnique({
    where: { id: sessionUser.id },
    select: { passwordHash: true, status: true },
  });
  if (!account || account.status !== "ACTIVE" || !(await verifyPassword(parsed.data.currentPassword, account.passwordHash))) {
    return NextResponse.json({ error: "Senha atual inválida." }, { status: 401 });
  }

  let newPasswordHash: string;
  try {
    newPasswordHash = await hashPassword(parsed.data.newPassword);
  } catch {
    return NextResponse.json({ error: "A nova senha não atende aos requisitos de segurança." }, { status: 400 });
  }

  const nextToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const now = new Date();

  await authPrisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: sessionUser.id },
      data: { passwordHash: newPasswordHash, mustChangePassword: false },
    });
    await tx.session.updateMany({
      where: { userId: sessionUser.id, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.session.create({
      data: { userId: sessionUser.id, tokenHash: hashSessionToken(nextToken), expiresAt },
    });
  });

  const response = NextResponse.json({ authenticated: true, passwordChanged: true });
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(SESSION_COOKIE, nextToken, {
    httpOnly: true,
    secure: secureCookie(request),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return response;
}
