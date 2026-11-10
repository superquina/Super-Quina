import { NextRequest, NextResponse } from "next/server";
import { authPrisma, getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";
import { reconcilePixPaymentFromProvider } from "@/modules/payments/reconcile-pix-payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
type RouteContext = { params: Promise<{ purchaseId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "É necessário entrar na conta." }, { status: 401, headers });
  if (user.role !== "PLAYER" || user.mustChangePassword) {
    return NextResponse.json({ error: "Acesso não permitido." }, { status: 403, headers });
  }

  const { purchaseId } = await context.params;
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(purchaseId)) {
    return NextResponse.json({ error: "Compra não encontrada." }, { status: 404, headers });
  }

  let purchase = await authPrisma.purchase.findFirst({
    where: { id: purchaseId, playerId: user.id },
    select: {
      status: true,
      receiptCode: true,
      confirmedAt: true,
      payment: { select: { id: true, status: true, provider: true, providerPaymentId: true, providerStatus: true, providerStatusDetail: true, confirmedAt: true, updatedAt: true } },
    },
  });
  if (!purchase) return NextResponse.json({ error: "Compra não encontrada." }, { status: 404, headers });

  // The browser polls every few seconds. Throttle direct provider reconciliation
  // to one lookup per payment per 10 seconds. Webhook and fallback converge on
  // the same idempotent confirmation transaction.
  if (purchase.status === "PENDING_PAYMENT"
    && purchase.payment?.status === "PENDING"
    && purchase.payment.provider === "MERCADO_PAGO"
    && purchase.payment.providerPaymentId
    && Date.now() - purchase.payment.updatedAt.getTime() >= 10_000) {
    const checkClaim = await authPrisma.payment.updateMany({
      where: {
        id: purchase.payment.id,
        status: "PENDING",
        updatedAt: { lt: new Date(Date.now() - 10_000) },
      },
      data: { updatedAt: new Date() },
    });
    if (checkClaim.count === 1) {
      try {
        await reconcilePixPaymentFromProvider(authPrisma, purchase.payment.id);
      } catch {
        // Provider/API outages leave the purchase pending; the timestamp claim
        // prevents every 3-second UI poll from immediately retrying the provider.
      }
    }
    purchase = await authPrisma.purchase.findFirst({
      where: { id: purchaseId, playerId: user.id },
      select: {
        status: true,
        receiptCode: true,
        confirmedAt: true,
        payment: { select: { id: true, status: true, provider: true, providerPaymentId: true, providerStatus: true, providerStatusDetail: true, confirmedAt: true, updatedAt: true } },
      },
    });
  }

  if (!purchase) return NextResponse.json({ error: "Compra não encontrada." }, { status: 404, headers });

  const confirmed = purchase.status === "CONFIRMED"
    && purchase.payment?.status === "CONFIRMED"
    && Boolean(purchase.receiptCode && purchase.confirmedAt && purchase.payment.confirmedAt);

  const reconciliationRequired = purchase.status === "PENDING_PAYMENT"
    && purchase.payment?.status === "PENDING"
    && purchase.payment.providerStatus === "processed"
    && purchase.payment.providerStatusDetail === "accredited";
  const paymentTerminal = ["FAILED", "CANCELLED", "EXPIRED"].includes(purchase.payment?.status ?? "")
    && purchase.status === "CANCELLED";

  return NextResponse.json({
    purchaseStatus: purchase.status,
    paymentStatus: purchase.payment?.status ?? "PENDING",
    reconciliationRequired,
    paymentTerminal,
    message: reconciliationRequired
      ? "O Mercado Pago confirmou o Pix. O sistema está vinculando a compra às próximas rodadas válidas. Não faça outro pagamento."
      : paymentTerminal
        ? "Pagamento não aceito ou não concluído pelo Mercado Pago. Este jogo não foi realizado e nenhuma aposta foi alocada. Se houve débito na sua conta, confira o extrato e entre em contato com o suporte antes de tentar novamente."
        : null,
    providerStatus: purchase.payment?.providerStatus ?? null,
    providerStatusDetail: purchase.payment?.providerStatusDetail ?? null,
    receiptReady: confirmed,
  }, { headers });
}
