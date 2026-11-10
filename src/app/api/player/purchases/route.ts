import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createNumericPurchase } from "@/modules/purchases/create-numeric-purchase";
import { PurchaseServiceError } from "@/modules/purchases/purchase-service-error";
import { authPrisma, getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";
import { createPixOrder, getPixOrder } from "@/modules/payments/mercado-pago";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  idempotencyKey: z.string().trim().min(16).max(200),
  repetitionCount: z.number().int().min(1).max(10),
  numbers: z.array(z.string().regex(/^\d{5}$/)).min(1).max(100),
  stakeCents: z.number().int().safe().min(100).max(2_000_000_000),
  paymentMethod: z.enum(["PIX", "WALLET"]).default("PIX"),
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
  if (user.role !== "PLAYER" || user.mustChangePassword) return NextResponse.json({ error: "Acesso não permitido." }, { status: 403, headers: { "Cache-Control": "no-store" } });

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Informe de 1 a 10 repetições, números de cinco algarismos e valores em centavos." }, { status: 400 });
  }

  try {
    const purchase = await createNumericPurchase(authPrisma, {
      idempotencyKey: parsed.data.idempotencyKey,
      playerId: user.id,
      paymentMethod: parsed.data.paymentMethod,
      roundCount: parsed.data.repetitionCount,
      numbers: parsed.data.numbers,
      stakeCents: parsed.data.stakeCents,
    });
    const purchaseView = {
      id: purchase.id, receiptCode: purchase.receiptCode, status: purchase.status,
      totalCents: purchase.totalCents, currency: purchase.currency,
      numericIntent: purchase.numericIntent ? {
        repetitionCount: purchase.numericIntent.roundCount,
        numbers: purchase.numericIntent.numbers,
        allocationCents: purchase.numericIntent.allocation,
      } : null,
      participations: purchase.participations.map((part) => ({
        roundId: part.roundId, totalCents: part.totalCents,
        lines: part.numericLines.map((line) => ({
          numberValue: line.numberValue,
          totalCents: line.unitCents + line.tensCents + line.hundredsCents + line.thousandsCents + line.quinaCents,
          allocationCents: { unit: line.unitCents, tens: line.tensCents, hundreds: line.hundredsCents, thousands: line.thousandsCents, quina: line.quinaCents },
        })),
      })),
    };

    if (purchase.status === "CONFIRMED" && purchase.payment?.status === "CONFIRMED" && purchase.receiptCode && purchase.confirmedAt) {
      return NextResponse.json({
        purchase: { ...purchaseView, paymentStatus: "CONFIRMED" },
        paymentActionRequired: false, receiptReady: true,
        message: "Esta compra já está confirmada. O recibo oficial está disponível.",
      }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }

    if (parsed.data.paymentMethod === "WALLET") {
      if (purchase.paymentMethod !== "WALLET") {
        return NextResponse.json({ error: "Método de pagamento inválido." }, { status: 409, headers: { "Cache-Control": "no-store" } });
      }
      if (purchase.status !== "CONFIRMED" || !purchase.receiptCode || !purchase.confirmedAt) {
        return NextResponse.json({
          purchase: { ...purchaseView, paymentStatus: "RECEIVED_AWAITING_ALLOCATION" },
          paymentActionRequired: false, receiptReady: false, allocationPending: true,
          message: "Pagamento realizado com o saldo da conta. A compra está registrada e aguarda a próxima sequência de rodadas para concluir a alocação e liberar o recibo.",
        }, { status: 202, headers: { "Cache-Control": "no-store" } });
      }
      return NextResponse.json({
        purchase: { ...purchaseView, paymentStatus: "CONFIRMED" },
        paymentActionRequired: false, receiptReady: true,
        message: "Pagamento realizado com o saldo da conta. O valor foi debitado e o recibo oficial está disponível.",
      }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }

    let pixCheckout: { copyPaste: string | null; qrCodeBase64: string | null; ticketUrl: string | null } | null = null;
    const payment = purchase.payment;
    if (payment && process.env.MERCADOPAGO_ACCESS_TOKEN?.trim()) {
      try {
        const checkout = payment.providerPaymentId
          ? await getPixOrder(payment.providerPaymentId)
          : await createPixOrder({
              purchaseId: purchase.id,
              paymentIdempotencyKey: payment.idempotencyKey,
              playerId: user.id,
              amountCents: purchase.totalCents,
            });
        if (checkout) {
          const updated = await authPrisma.payment.update({
            where: { id: payment.id },
            data: {
              providerPaymentId: checkout.orderId, pixCopyPaste: checkout.qrCode,
              pixQrCodeBase64: checkout.qrCodeBase64, pixTicketUrl: checkout.ticketUrl,
              providerStatus: checkout.status, providerStatusDetail: checkout.statusDetail,
            },
            select: { pixCopyPaste: true, pixQrCodeBase64: true, pixTicketUrl: true },
          });
          pixCheckout = { copyPaste: updated.pixCopyPaste, qrCodeBase64: updated.pixQrCodeBase64, ticketUrl: updated.pixTicketUrl };
          if (!updated.pixCopyPaste) {
            return NextResponse.json({
              error: "O Mercado Pago registrou o pedido, mas ainda não disponibilizou o QR Code. Tente novamente em instantes; o mesmo pedido será consultado, sem criar outra cobrança.",
              code: "PIX_QR_NOT_READY",
              purchaseId: purchase.id,
            }, { status: 502, headers: { "Cache-Control": "no-store" } });
          }
        }
      } catch {
        return NextResponse.json({
          error: "A compra foi registrada, mas não foi possível preparar o Pix agora. Tente novamente; a mesma chave de idempotência será reutilizada.",
          code: "PIX_CHECKOUT_UNAVAILABLE", purchaseId: purchase.id,
        }, { status: 502, headers: { "Cache-Control": "no-store" } });
      }
    }

    return NextResponse.json({
      purchase: { ...purchaseView, paymentStatus: purchase.payment?.status ?? "PENDING" },
      pixCheckout, paymentActionRequired: true,
      message: pixCheckout
        ? "Pix preparado. A compra e o recibo continuam pendentes até a confirmação autêntica do Mercado Pago."
        : "Compra registrada como pendente. Nenhum recibo foi emitido porque o pagamento ainda não foi confirmado. A cobrança Pix ainda não foi criada: configure as credenciais do Mercado Pago no ambiente de desenvolvimento.",
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PurchaseServiceError) {
      const status = error.code === "INVALID_ACTOR" ? 403
        : error.code === "INSUFFICIENT_BALANCE" || error.code === "IDEMPOTENCY_CONFLICT" || error.code === "ROUND_UNAVAILABLE" ? 409
          : error.code === "INVALID_IDEMPOTENCY_KEY" ? 400 : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Não foi possível registrar a compra agora." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
