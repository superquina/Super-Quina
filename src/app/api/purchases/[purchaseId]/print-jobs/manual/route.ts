import { NextRequest, NextResponse } from "next/server";
import { authPrisma, getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";
import { createManualReceiptReprint, PrintJobServiceError } from "@/modules/printing/print-job-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
type RouteContext = { params: Promise<{ purchaseId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "É necessário entrar na conta." }, { status: 401, headers });
  if (user.mustChangePassword || !["ADMIN", "CASHIER", "PLAYER"].includes(user.role)) {
    return NextResponse.json({ error: "Acesso não permitido." }, { status: 403, headers });
  }

  const { purchaseId } = await context.params;
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(purchaseId)) {
    return NextResponse.json({ error: "Compra não encontrada." }, { status: 404, headers });
  }

  try {
    const job = await createManualReceiptReprint(authPrisma, { purchaseId, actorId: user.id });
    return NextResponse.json({
      job: { id: job.id, status: job.status, purpose: job.purpose },
    }, { status: 201, headers });
  } catch (error) {
    if (error instanceof PrintJobServiceError) {
      const status = error.code === "PURCHASE_NOT_FOUND" ? 404
        : error.code === "ACTOR_NOT_ALLOWED" ? 403
          : error.code === "RECEIPT_NOT_READY" ? 409 : 400;
      return NextResponse.json({ error: error.message }, { status, headers });
    }
    return NextResponse.json({ error: "Não foi possível registrar a reimpressão agora." }, { status: 500, headers });
  }
}
