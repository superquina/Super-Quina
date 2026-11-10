import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createNumericPurchase } from "@/modules/purchases/create-numeric-purchase";
import { PurchaseServiceError } from "@/modules/purchases/purchase-service-error";
import { authPrisma, getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  idempotencyKey: z.string().trim().min(16).max(200),
  repetitionCount: z.number().int().min(1).max(10),
  numbers: z.array(z.string().regex(/^\d{5}$/)).min(1).max(100),
  stakeCents: z.number().int().safe().min(100).max(2_000_000_000),
}).strict();

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return NextResponse.json({ error: "Requisição inválida." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (origin) {
    let originHost = "";
    try {
      const parsedOrigin = new URL(origin);
      if (parsedOrigin.protocol !== "https:" && parsedOrigin.protocol !== "http:") {
        return NextResponse.json({ error: "Requisição inválida." }, { status: 403 });
      }
      originHost = parsedOrigin.host.toLowerCase();
    } catch {
      return NextResponse.json({ error: "Requisição inválida." }, { status: 403 });
    }
    const requestHost = request.headers.get("host")?.trim().toLowerCase();
    if (!requestHost || originHost !== requestHost) {
      return NextResponse.json({ error: "Requisição inválida." }, { status: 403 });
    }
  }
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "É necessário entrar na conta." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (user.role !== "CASHIER" || user.mustChangePassword) return NextResponse.json({ error: "Acesso não permitido." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Informe de 1 a 10 repetições, números de cinco algarismos e valores em centavos." }, { status: 400 });
  }
  try {
    const purchase = await createNumericPurchase(authPrisma, {
      idempotencyKey: parsed.data.idempotencyKey, cashierId: user.id, paymentMethod: "CASH",
      roundCount: parsed.data.repetitionCount, numbers: parsed.data.numbers, stakeCents: parsed.data.stakeCents,
    });
    if (purchase.paymentMethod !== "CASH") {
      return NextResponse.json({ error: "Método de pagamento inválido." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (purchase.status !== "CONFIRMED" || !purchase.receiptCode) {
      return NextResponse.json({
        purchase: {
          id: purchase.id, receiptCode: null, status: purchase.status, paymentMethod: purchase.paymentMethod,
          totalCents: purchase.totalCents, currency: purchase.currency, confirmedAt: null, participations: [],
        },
        receiptReady: false, allocationPending: true,
        message: "Valor recebido e venda registrada. O sistema está aguardando a próxima sequência de rodadas para concluir a alocação e liberar o recibo.",
      }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({
      purchase: {
        id: purchase.id, receiptCode: purchase.receiptCode, status: purchase.status,
        paymentMethod: purchase.paymentMethod, totalCents: purchase.totalCents, currency: purchase.currency,
        confirmedAt: purchase.confirmedAt,
        participations: purchase.participations.map((part) => ({
          roundId: part.roundId, totalCents: part.totalCents,
          lines: part.numericLines.map((line) => ({
            numberValue: line.numberValue,
            totalCents: line.unitCents + line.tensCents + line.hundredsCents + line.thousandsCents + line.quinaCents,
            allocationCents: { unit: line.unitCents, tens: line.tensCents, hundreds: line.hundredsCents, thousands: line.thousandsCents, quina: line.quinaCents },
          })),
        })),
      },
      message: "Venda em dinheiro registrada e confirmada. O recibo foi emitido.",
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PurchaseServiceError) {
      const status = error.code === "INVALID_ACTOR" ? 403
        : error.code === "IDEMPOTENCY_CONFLICT" || error.code === "ROUND_UNAVAILABLE" ? 409 : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Não foi possível registrar a venda em dinheiro." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
