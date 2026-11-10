"use client";

import { useEffect, useRef, useState } from "react";
import { ThermalReceipt } from "@/components/receipts/thermal-receipt";
import type { ThermalReceiptEntry } from "@/components/receipts/thermal-receipt-types";

type ReceiptData = {
  receiptCode: string;
  paymentStatus: "CONFIRMED";
  issuedAt: string;
  paymentMethod: string;
  totalCents: number;
  currency: string;
  customerLabel: string | null;
  cashierLabel: string | null;
  entries: ThermalReceiptEntry[];
};

const paymentLabels: Record<string, string> = {
  PIX: "Pix confirmado",
  CASH: "Dinheiro recebido",
  WALLET: "Saldo da conta debitado",
  CARD: "Cartão confirmado",
};

const MAX_MANUAL_RETRIES = 2;

export function PlayerPurchaseReceipt({ purchaseId, autoOpen = false, onClose }: { purchaseId: string; autoOpen?: boolean; onClose?: () => void }) {
  const [receipt, setReceipt] = useState<{ purchaseId: string; data: ReceiptData } | null>(null);
  const [loadingState, setLoadingState] = useState<{ purchaseId: string; value: boolean } | null>(null);
  const [errorState, setErrorState] = useState<{ purchaseId: string; value: string } | null>(null);
  const [retryState, setRetryState] = useState<{ purchaseId: string; value: number } | null>(null);
  const loading = loadingState?.purchaseId === purchaseId && loadingState.value;
  const error = errorState?.purchaseId === purchaseId ? errorState.value : "";
  const manualRetries = retryState?.purchaseId === purchaseId ? retryState.value : 0;
  const loadingRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);

  async function loadReceipt(isManualRetry = false) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoadingState({ purchaseId, value: true });
    setErrorState({ purchaseId, value: "" });
    try {
      const response = await fetch(`/api/player/purchases/${encodeURIComponent(purchaseId)}/receipt`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.json() as { receipt?: ReceiptData; error?: string };
      if (!response.ok || !body.receipt) {
        throw new Error(body.error ?? "Não foi possível carregar o recibo.");
      }
      if (!controller.signal.aborted && requestRef.current === controller) setReceipt({ purchaseId, data: body.receipt });
    } catch (reason) {
      if (!controller.signal.aborted && requestRef.current === controller) {
        setErrorState({ purchaseId, value: reason instanceof Error ? reason.message : "Não foi possível carregar o recibo." });
        if (isManualRetry) setRetryState((current) => ({
          purchaseId,
          value: (current?.purchaseId === purchaseId ? current.value : 0) + 1,
        }));
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        loadingRef.current = false;
        setLoadingState({ purchaseId, value: false });
      }
    }
  }

  useEffect(() => {
    const timer = autoOpen ? window.setTimeout(() => { void loadReceipt(); }, 0) : null;
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      requestRef.current?.abort();
      requestRef.current = null;
      loadingRef.current = false;
    };
    // The purchase ID is stable for this mounted receipt component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, purchaseId]);

  const canRetry = manualRetries < MAX_MANUAL_RETRIES;

  return (
    <div className="player-purchase-receipt">
      {!receipt && !autoOpen && (
        <button type="button" onClick={() => { void loadReceipt(); }} disabled={loading}>
          {loading ? "Carregando recibo…" : "Consultar / imprimir recibo oficial"}
        </button>
      )}
      {error && (
        <div className="note-inline" role="alert">
          <p>{error}</p>
          <p>Referência da venda: <strong>{purchaseId}</strong>. Informe esse código à administração se o recibo continuar indisponível.</p>
          {canRetry ? (
            <button type="button" onClick={() => { void loadReceipt(true); }} disabled={loading}>
              {loading ? "Consultando…" : `Tentar buscar recibo novamente (${manualRetries + 1}/${MAX_MANUAL_RETRIES})`}
            </button>
          ) : (
            <p>As tentativas foram concluídas. Encaminhe a referência acima à administração para recuperar o recibo original. Não faça outra venda nem outro pagamento.</p>
          )}
        </div>
      )}
      {receipt?.purchaseId === purchaseId && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel receipt-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-heading">
            <h2 id="receipt-heading">Recibo oficial</h2>
            <ThermalReceipt
              receiptCode={receipt.data.receiptCode}
              paymentStatus={receipt.data.paymentStatus}
              issuedAt={receipt.data.issuedAt}
              totalCents={receipt.data.totalCents}
              entries={receipt.data.entries}
              customerLabel={receipt.data.customerLabel}
              cashierLabel={receipt.data.cashierLabel}
              paymentLabel={paymentLabels[receipt.data.paymentMethod] ?? "Pagamento confirmado"}
              onClose={() => { setReceipt(null); onClose?.(); }}
            />
          </section>
        </div>
      )}
    </div>
  );
}
