import { NextRequest, NextResponse } from "next/server";
import { authPrisma, getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";
import { PrintJobServiceError, transitionPrintJob } from "@/modules/printing/print-job-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
type RouteContext = { params: Promise<{ jobId: string }> };
const failureCodes = new Set([
  "PERMISSION_DENIED",
  "DEVICE_UNAVAILABLE",
  "CONNECTION_FAILED",
  "WRITE_FAILED",
  "ENCODING_FAILED",
  "RECEIPT_UNAVAILABLE",
  "UNKNOWN_TRANSPORT_RESULT",
]);

export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "É necessário entrar na conta." }, { status: 401, headers });
  if (user.mustChangePassword || !["ADMIN", "CASHIER", "PLAYER"].includes(user.role)) {
    return NextResponse.json({ error: "Acesso não permitido." }, { status: 403, headers });
  }

  const { jobId } = await context.params;
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(jobId)) {
    return NextResponse.json({ error: "Trabalho de impressão não encontrado." }, { status: 404, headers });
  }

  const job = await authPrisma.printJob.findUnique({
    where: { id: jobId },
    select: { id: true, purchase: { select: { playerId: true, cashierId: true } } },
  });
  if (!job) return NextResponse.json({ error: "Trabalho de impressão não encontrado." }, { status: 404, headers });
  const ownsPurchase = user.role === "ADMIN"
    || (user.role === "PLAYER" && job.purchase.playerId === user.id)
    || (user.role === "CASHIER" && job.purchase.cashierId === user.id);
  if (!ownsPurchase) return NextResponse.json({ error: "Trabalho de impressão não encontrado." }, { status: 404, headers });

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400, headers }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400, headers });
  }
  const value = body as Record<string, unknown>;
  const nextStatus = value.nextStatus;
  if (!["SENDING", "SENT", "FAILED", "UNKNOWN"].includes(String(nextStatus))) {
    return NextResponse.json({ error: "Estado de impressão inválido." }, { status: 400, headers });
  }
  if (value.deviceName !== undefined && value.deviceName !== null
    && (typeof value.deviceName !== "string" || value.deviceName.length > 120)) {
    return NextResponse.json({ error: "Identificação da impressora inválida." }, { status: 400, headers });
  }
  if (value.errorCode !== undefined && value.errorCode !== null
    && (typeof value.errorCode !== "string" || !failureCodes.has(value.errorCode))) {
    return NextResponse.json({ error: "Código de falha inválido." }, { status: 400, headers });
  }

  try {
    const updated = await transitionPrintJob(authPrisma, {
      jobId,
      nextStatus: nextStatus as "SENDING" | "SENT" | "FAILED" | "UNKNOWN",
      deviceName: value.deviceName as string | null | undefined,
      errorCode: value.errorCode as "PERMISSION_DENIED" | "DEVICE_UNAVAILABLE" | "CONNECTION_FAILED" | "WRITE_FAILED" | "ENCODING_FAILED" | "RECEIPT_UNAVAILABLE" | "UNKNOWN_TRANSPORT_RESULT" | null | undefined,
    });
    return NextResponse.json({
      job: { id: updated.id, status: updated.status, purpose: updated.purpose, completedAt: updated.completedAt },
    }, { headers });
  } catch (error) {
    if (error instanceof PrintJobServiceError) {
      return NextResponse.json({ error: error.message }, { status: 409, headers });
    }
    return NextResponse.json({ error: "Não foi possível atualizar o trabalho de impressão." }, { status: 500, headers });
  }
}
