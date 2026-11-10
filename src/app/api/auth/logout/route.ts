import { NextRequest, NextResponse } from "next/server";
import { revokeSession, SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";

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

    // Match the browser Origin against the incoming Host. Behind a reverse
    // proxy, nextUrl.origin may describe the internal request URL.
    const requestHost = request.headers.get("host");
    if (!requestHost || originHost !== requestHost) {
      return NextResponse.json({ error: "Requisição inválida." }, { status: 403 });
    }
  }

  await revokeSession(request.cookies.get(SESSION_COOKIE)?.value);
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:" || process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
