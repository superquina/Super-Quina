"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PlayerPurchaseReceipt } from "@/components/receipts/player-purchase-receipt";

type Mode = "PLAYER" | "CASHIER";
type PaymentMethod = "PIX" | "WALLET" | "CASH";
type NumericLine = { numberValue: string; totalCents: number; allocationCents: Record<string, number> };
type Purchase = {
  id: string; receiptCode: string | null; status: string; totalCents: number; currency: string;
  paymentStatus?: string;
  numericIntent?: { repetitionCount: number; numbers: string[]; allocationCents: Record<string, number> } | null;
  participations: Array<{ roundId: string; totalCents: number; lines: NumericLine[] }>;
};
type PixCheckout = { copyPaste: string | null; qrCodeBase64: string | null; ticketUrl: string | null };

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}
function parseStake(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(cents) && cents >= 100 && cents <= 2_000_000_000 ? cents : null;
}
function clearInput(value: string) {
  return value.replace(/\D/g, "").slice(0, 5);
}

export function NumericGamePurchaseForm({ mode }: { mode: Mode }) {
  const [repetitionCount, setParticipationCount] = useState(1);
  const [numberInput, setNumberInput] = useState("");
  const [numbers, setNumbers] = useState<string[]>([]);
  const [stake, setStake] = useState("1,00");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("PIX");
  const [walletBalanceCents, setWalletBalanceCents] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [backgroundPurchases, setBackgroundPurchases] = useState<Purchase[]>([]);
  const [readyReceiptIds, setReadyReceiptIds] = useState<string[]>([]);
  const [pixCheckout, setPixCheckout] = useState<PixCheckout | null>(null);
  const [pixModalOpen, setPixModalOpen] = useState(false);
  const [pixCopied, setPixCopied] = useState(false);
  const [purchaseMessage, setPurchaseMessage] = useState("");
  const [receiptPurchaseId, setReceiptPurchaseId] = useState<string | null>(null);
  const idempotency = useRef<{ signature: string; key: string } | null>(null);
  const [reconciliationRequired, setReconciliationRequired] = useState(false);

  useEffect(() => {
    if (mode !== "PLAYER") return;
    let active = true;
    const updateBalance = (event: Event) => {
      const detail = (event as CustomEvent<{ availableCents: number }>).detail;
      if (typeof detail?.availableCents === "number") setWalletBalanceCents(detail.availableCents);
    };
    window.addEventListener("superquina:player-wallet-updated", updateBalance);
    fetch("/api/player/withdrawals", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => { if (active && typeof body.availableCents === "number") setWalletBalanceCents(body.availableCents); })
      .catch(() => { if (active) setWalletBalanceCents(null); });
    return () => {
      active = false;
      window.removeEventListener("superquina:player-wallet-updated", updateBalance);
    };
  }, [mode]);

  useEffect(() => {
    if (backgroundPurchases.length === 0) return;
    let active = true;
    let checking = false;
    const checkPendingPurchases = async () => {
      if (!active || checking) return;
      checking = true;
      try {
        const results = await Promise.all(backgroundPurchases.map(async (item) => {
          try {
            const endpoint = mode === "PLAYER"
              ? `/api/player/purchases/${encodeURIComponent(item.id)}/status`
              : `/api/cashier/purchases/${encodeURIComponent(item.id)}/status`;
            const response = await fetch(endpoint, { cache: "no-store" });
            if (!response.ok) return { id: item.id, state: "pending" as const };
            const body = await response.json();
            if (body.receiptReady) return { id: item.id, state: "ready" as const };
            if (body.paymentTerminal || ["FAILED", "CANCELLED", "EXPIRED"].includes(body.paymentStatus ?? "") || body.purchaseStatus === "CANCELLED") {
              return { id: item.id, state: "failed" as const };
            }
            return { id: item.id, state: "pending" as const };
          } catch {
            return { id: item.id, state: "pending" as const };
          }
        }));
        if (!active) return;
        const ready = results.filter((item) => item.state === "ready").map((item) => item.id);
        const finished = results.filter((item) => item.state !== "pending").map((item) => item.id);
        if (ready.length) setReadyReceiptIds((current) => [...current, ...ready.filter((id) => !current.includes(id))]);
        if (finished.length) setBackgroundPurchases((current) => current.filter((item) => !finished.includes(item.id)));
      } finally {
        checking = false;
      }
    };
    void checkPendingPurchases();
    const timer = window.setInterval(() => { void checkPendingPurchases(); }, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [mode, backgroundPurchases]);

  const activeReceiptPurchaseId = receiptPurchaseId ?? readyReceiptIds[0] ?? null;

  useEffect(() => {
    if (!purchase?.id || (mode === "PLAYER" && paymentMethod !== "PIX")) return;
    let active = true;
    const endpoint = mode === "PLAYER"
      ? `/api/player/purchases/${encodeURIComponent(purchase.id)}/status`
      : `/api/cashier/purchases/${encodeURIComponent(purchase.id)}/status`;
    let checking = false;
    const check = async () => {
      if (!active || checking) return;
      checking = true;
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json();
        if (!active) return;
        if (body.receiptReady) {
          setReceiptPurchaseId(purchase.id);
          idempotency.current = null;
          setPurchase(null); setPixCheckout(null); setPurchaseMessage(""); setPixModalOpen(false); setReconciliationRequired(false);
          setNumbers([]); setNumberInput(""); setParticipationCount(1);
          setNotice(mode === "CASHIER" && paymentMethod === "CASH"
            ? "Venda em dinheiro confirmada e recibo liberado."
            : "Pagamento confirmado. Sua aposta foi registrada.");
        } else {
          setReconciliationRequired(Boolean(body.reconciliationRequired));
          const terminalFailure = body.paymentTerminal === true
            || ["FAILED", "CANCELLED", "EXPIRED"].includes(body.paymentStatus ?? "")
            || body.purchaseStatus === "CANCELLED";
          if (terminalFailure) {
            setPurchase(null); setPixCheckout(null); setPixModalOpen(false); setReconciliationRequired(false); setPurchaseMessage(""); idempotency.current = null;
            setNotice("");
            setError(typeof body.message === "string" && body.message
              ? body.message
              : "Pagamento não aceito ou não concluído. Este jogo não foi realizado e nenhuma aposta foi alocada.");
          }
        }
      } catch { /* A falha temporária de consulta não altera o estado financeiro. */ }
      finally { checking = false; }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [mode, paymentMethod, purchase?.id]);

  const stakeCents = useMemo(() => parseStake(stake), [stake]);
  const pendingNumber = clearInput(numberInput);
  const hasPendingNumber = numberInput.length > 0;
  const effectiveNumbers = hasPendingNumber && /^\d{5}$/.test(pendingNumber)
    ? [...numbers, pendingNumber]
    : numbers;
  const totalEstimate = stakeCents !== null ? stakeCents * effectiveNumbers.length * repetitionCount : 0;

  function generateRandomNumber() {
    const existing = new Set(numbers);
    let generated = "";
    do {
      // Reject the incomplete range so every five-digit value has equal probability.
      const range = 0x1_0000_0000;
      const limit = Math.floor(range / 100000) * 100000;
      const sample = new Uint32Array(1);
      let value: number;
      do {
        crypto.getRandomValues(sample);
        value = sample[0]!;
      } while (value >= limit);
      generated = String(value % 100000).padStart(5, "0");
    } while (existing.has(generated));
    setNumberInput(generated);
    setError("");
    setNotice("Número gerado. Você já pode continuar ou adicionar outros números.");
  }

  function addNumber() {
    const normalized = clearInput(numberInput);
    if (!/^\d{5}$/.test(normalized)) { setError("Digite exatamente cinco algarismos, incluindo os zeros à esquerda."); return; }
    setError(""); setNotice("");
    if (numbers.includes(normalized)) { setError("Esse número já foi adicionado."); return; }
    setNumbers((current) => [...current, normalized]);
    setNumberInput("");
  }

  function resetGameForm() {
    idempotency.current = null;
    setNumbers([]);
    setNumberInput("");
    setStake("1,00");
    setParticipationCount(1);
    setPaymentMethod("PIX");
    setError("");
    setNotice("");
    setPurchaseMessage("");
    setPixCheckout(null);
    setPixCopied(false);
    setReconciliationRequired(false);
  }

  function leavePixWindow() {
    if (purchase) {
      setBackgroundPurchases((current) => current.some((item) => item.id === purchase.id) ? current : [...current, purchase]);
    }
    setPixModalOpen(false);
    setPurchase(null);
    resetGameForm();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice("");
    if (hasPendingNumber && !/^\d{5}$/.test(pendingNumber)) {
      setError("Complete os cinco algarismos do número ou apague o campo para continuar com os números já adicionados.");
      return;
    }
    const numbersToSubmit = hasPendingNumber ? [...numbers, pendingNumber] : numbers;
    if (!numbersToSubmit.length) { setError("Digite ou gere um número de cinco algarismos para continuar."); return; }
    if (new Set(numbersToSubmit).size !== numbersToSubmit.length) {
      setError("Esse número já foi adicionado. Remova a repetição antes de continuar.");
      return;
    }
    if (stakeCents === null) { setError("O valor mínimo por número e rodada é R$ 1,00."); return; }
    if (mode === "PLAYER" && paymentMethod === "WALLET" && (walletBalanceCents === null || walletBalanceCents < totalEstimate)) {
      setError("Saldo insuficiente ou indisponível para esta compra."); return;
    }
    setSubmitting(true);
    try {
      const signature = JSON.stringify({ repetitionCount, numbers: numbersToSubmit, stakeCents, paymentMethod });
      const idempotencyKey = idempotency.current?.signature === signature
        ? idempotency.current.key
        : crypto.randomUUID();
      idempotency.current = { signature, key: idempotencyKey };
      const endpoint = mode === "PLAYER" ? "/api/player/purchases"
        : paymentMethod === "CASH" ? "/api/cashier/purchases/cash" : "/api/cashier/purchases/create";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: idempotencyKey,
          repetitionCount,
          numbers: numbersToSubmit,
          stakeCents,
          ...(mode === "PLAYER" ? { paymentMethod } : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível registrar a compra.");
      const created = body.purchase as Purchase;
      if (paymentMethod === "CASH" && body.allocationPending) {
        setPurchase(created);
        setPurchaseMessage(typeof body.message === "string" ? body.message : "Venda recebida; aguardando a alocação nas próximas rodadas.");
        setPixCheckout(null);
        setPixModalOpen(false);
        setNotice("Venda recebida. A tela acompanhará a alocação e abrirá o recibo quando estiver concluída.");
      } else if (paymentMethod === "CASH" || paymentMethod === "WALLET" || body.receiptReady) {
        if (body.allocationPending) {
          idempotency.current = null;
          setNumbers([]); setNumberInput(""); setParticipationCount(1);
          setNotice("Pagamento recebido e compra registrada. Aguardando a alocação automática nas próximas rodadas; o recibo será liberado depois.");
        } else {
          setReceiptPurchaseId(created.id);
          idempotency.current = null;
          setNumbers([]); setNumberInput(""); setParticipationCount(1);
          setNotice("Compra confirmada. Sua aposta foi registrada.");
        }
      } else {
        setPurchase(created);
        setPurchaseMessage(typeof body.message === "string" ? body.message : "Aguardando confirmação do pagamento.");
        setPixCheckout((body.pixCheckout as PixCheckout | null) ?? null);
        setPixModalOpen(true);
        setReconciliationRequired(false);
      }
      if (mode === "PLAYER" && paymentMethod === "WALLET" && walletBalanceCents !== null) {
        const nextBalance = walletBalanceCents - totalEstimate;
        setWalletBalanceCents(nextBalance);
        window.dispatchEvent(new CustomEvent("superquina:player-wallet-updated", { detail: { availableCents: nextBalance } }));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível concluir a compra.");
    } finally { setSubmitting(false); }
  }

  return (
    <section className="feature-card numeric-game-purchase">
      <div className="feature-label numeric-game-heading">NOVO JOGO</div>
      <form onSubmit={submit}>
        <div className="numeric-entry-row">
          <input id="numeric-number" aria-label="Número de cinco algarismos" disabled={Boolean(purchase)} value={numberInput}
            onChange={(event) => setNumberInput(clearInput(event.target.value))}
            inputMode="numeric" pattern="[0-9]{5}" maxLength={5} placeholder="00000" autoComplete="off" />
          <div className="numeric-entry-actions">
            <button type="button" className="secondary-button" disabled={Boolean(purchase)} onClick={addNumber}>Adicionar</button>
            <button type="button" className="secondary-button" disabled={Boolean(purchase)} onClick={generateRandomNumber}>Gerador</button>
          </div>
        </div>

        {numbers.length > 0 && <div className="added-numbers">
          <strong>Números adicionados ({numbers.length})</strong>
          {numbers.map((value, index) => <div className="added-number-row" key={value + "-" + index}>
            <span className="numeric-number-chip">{value}</span>
            <button type="button" className="remove-number-button" disabled={Boolean(purchase)} onClick={() => setNumbers((current) => current.filter((_, i) => i !== index))}>Remover</button>
          </div>)}
        </div>}

        <div className="numeric-stake-summary-row">
          <div className="numeric-stake-control">
            <label htmlFor="numeric-stake">Valor da aposta (R$)</label>
            <input id="numeric-stake" disabled={Boolean(purchase)} value={stake} onChange={(event) => setStake(event.target.value)} inputMode="decimal" />
          </div>
          <div className="numeric-total-box" aria-live="polite">
            <span>Total</span>
            <strong>{money(totalEstimate)}</strong>
          </div>
        </div>

        <fieldset className="round-repeat-fieldset" disabled={Boolean(purchase)}>
          <legend>Repetições</legend>
          <select aria-label="Repetições" value={String(repetitionCount)}
            onChange={(event) => setParticipationCount(Math.max(1, Math.min(10, Number(event.target.value) || 1)))}>
            {Array.from({ length: 10 }, (_, index) => index + 1)
              .map((count) => <option key={count} value={count}>{count} {count === 1 ? "vez" : "vezes"}</option>)}
          </select>
        </fieldset>

        {mode === "PLAYER" ? <fieldset className="round-repeat-fieldset round-payment-fieldset" disabled={Boolean(purchase)}>
          <legend>Forma de pagamento</legend>
          <label><input type="radio" name="numeric-payment" checked={paymentMethod === "PIX"} onChange={() => setPaymentMethod("PIX")} /> Pix</label>
          <label><input type="radio" name="numeric-payment" checked={paymentMethod === "WALLET"} onChange={() => setPaymentMethod("WALLET")} /> Saldo da conta</label>
          {paymentMethod === "WALLET" && <p>Saldo disponível: {walletBalanceCents === null ? "indisponível" : money(walletBalanceCents)}</p>}
        </fieldset> : <fieldset className="round-repeat-fieldset round-payment-fieldset" disabled={Boolean(purchase)}>
          <legend>Forma de pagamento</legend>
          <label><input type="radio" name="numeric-payment" checked={paymentMethod === "PIX"} onChange={() => setPaymentMethod("PIX")} /> Pix</label>
          <label><input type="radio" name="numeric-payment" checked={paymentMethod === "CASH"} onChange={() => setPaymentMethod("CASH")} /> Dinheiro</label>
        </fieldset>}

        {error && <p role="alert" className="note-inline form-feedback-error">{error}</p>}
        {notice && <p role="status" className="note-inline form-feedback-success">{notice}</p>}
        <button type="submit" disabled={submitting || Boolean(purchase) || (!numbers.length && !/^\d{5}$/.test(pendingNumber))}>
          {submitting ? "Registrando…" : "Continuar"}
        </button>
      </form>

      {purchase && mode === "CASHIER" && paymentMethod === "CASH" && !pixModalOpen && (
        <p role="status" className="note-inline">{purchaseMessage || "Venda recebida; aguardando a alocação automática para liberar o recibo."}</p>
      )}

      {purchase && pixModalOpen && <div className="modal-backdrop" role="presentation">
        <section className="modal-panel pix-modal" role="dialog" aria-modal="true" aria-labelledby="numeric-pix-heading">
          <h3 id="numeric-pix-heading">Pagamento Pix</h3>
          <p>Total: <strong>{money(purchase.totalCents)}</strong></p>
          {purchase.numericIntent && <p>Repetições: {purchase.numericIntent.repetitionCount} {purchase.numericIntent.repetitionCount === 1 ? "vez" : "vezes"}</p>}
          {purchase.numericIntent ? purchase.numericIntent.numbers.map((number, index) => <div key={"intent-" + number + "-" + index}>
            <strong>{number}</strong> — {money(Object.values(purchase.numericIntent!.allocationCents).reduce((sum, value) => sum + value, 0))}
          </div>) : purchase.participations.flatMap((part) => part.lines.map((line, index) => <div key={part.roundId + line.numberValue + index}>
            <strong>{line.numberValue}</strong> — {money(line.totalCents)}
            <small>Unidade {money(line.allocationCents.unit)} · Dezena {money(line.allocationCents.tens)} · Centena {money(line.allocationCents.hundreds)} · Milhar {money(line.allocationCents.thousands)} · Quina {money(line.allocationCents.quina)}</small>
          </div>))}
          {!reconciliationRequired && pixCheckout?.qrCodeBase64 && <div className="pix-checkout">
            <img src={"data:image/png;base64," + pixCheckout.qrCodeBase64} alt="QR Code para pagar a compra via Pix" width={240} height={240} />
          </div>}
          {pixCheckout?.copyPaste && <button type="button" className={`secondary-button pix-copy-button${pixCopied ? " is-copied" : ""}`} onClick={async () => {
            try {
              await navigator.clipboard.writeText(pixCheckout.copyPaste!);
              setPixCopied(true);
              window.setTimeout(() => setPixCopied(false), 2200);
            } catch {
              setPixCopied(false);
            }
          }}>{pixCopied ? "Código copiado!" : "Copiar código Pix"}</button>}
          <button type="button" className="secondary-button pix-close-button" onClick={leavePixWindow}>Sair</button>
        </section>
      </div>}

      {activeReceiptPurchaseId && <PlayerPurchaseReceipt purchaseId={activeReceiptPurchaseId} autoOpen onClose={() => {
        if (receiptPurchaseId) setReceiptPurchaseId(null);
        else setReadyReceiptIds((current) => current.slice(1));
        resetGameForm();
      }} />}
    </section>
  );
}
