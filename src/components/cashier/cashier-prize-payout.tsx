"use client";

import { FormEvent, useState } from "react";

type PrizeLine = {
  id: string;
  numberValue: string;
  roundCode: string;
  roundCompleted: boolean;
  resultNumber: string | null;
  resultAt: string;
  stakeCents: number;
  prizeCategoryLabel: string | null;
  categoryStakeCents: number | null;
  multiplier: number | null;
  calculatedPrizeCents: number | null;
  calculationConsistent: boolean;
  participationTotalCents: number;
  purchaseTotalCents: number;
  prizeCents: number;
  paid: boolean;
  payoutChannel: "PLATFORM_PIX" | "CASHIER_CASH" | "WALLET" | null;
  paidAt: string | null;
};

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export function CashierPrizePayout() {
  const [receiptCode, setReceiptCode] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<PrizeLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyLine, setBusyLine] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setError(""); setMessage(""); setLines([]);
    try {
      const response = await fetch("/api/cashier/prizes/lookup?q=" + encodeURIComponent(receiptCode), { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível consultar o recibo.");
      setLines(body.lines as PrizeLine[]);
      setMessage(body.lines.length ? "Confira os números premiados antes de entregar o dinheiro." : "Este recibo não possui números confirmados.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao consultar o recibo.");
    } finally { setLoading(false); }
  }

  async function pay(lineId: string) {
    if (!window.confirm("Confirma que o dinheiro deste prêmio já foi entregue ao ganhador e que o comprovante físico foi conferido e retido?")) return;
    setBusyLine(lineId); setError(""); setMessage("");
    try {
      const response = await fetch("/api/cashier/prizes/" + encodeURIComponent(lineId) + "/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: reference.trim() || undefined }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível registrar o pagamento.");
      setLines((current) => current.map((line) => line.id === lineId
        ? { ...line, paid: true, payoutChannel: "CASHIER_CASH", paidAt: body.payout.paidAt }
        : line));
      setMessage("Pagamento em dinheiro registrado. O prêmio foi vinculado ao seu financeiro.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao registrar o pagamento.");
    } finally { setBusyLine(""); }
  }

  return <section className="player-collapsible-section cashier-prize-payout" aria-label="Pagamento de prêmios em dinheiro">
    <div className="cashier-prize-payout-heading">
      <span className="player-collapsible-label">Premiações</span>
    </div>
    <form onSubmit={lookup} className="cashier-prize-lookup-form">
      <label htmlFor="cashier-prize-receipt">Código do recibo</label>
      <input id="cashier-prize-receipt" value={receiptCode} onChange={(event) => setReceiptCode(event.target.value.toUpperCase())} placeholder="SQ-XXXXXXXX" autoComplete="off" required />
      <label htmlFor="cashier-prize-reference">Referência (opcional)</label>
      <input id="cashier-prize-reference" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={300} placeholder="Ex.: número do controle interno" />
      <button type="submit" disabled={loading}>{loading ? "Consultando…" : "Consultar recibo"}</button>
    </form>
    {error && <p role="alert" className="note-inline">{error}</p>}
    {message && <p role="status" className="note-inline">{message}</p>}
    {lines.length > 0 && <div className="cashier-prize-lines">
      {lines.map((line) => <article className="cashier-prize-line" key={line.id}>
        <div>
          <strong>Número {line.numberValue}</strong>
          <p>Rodada: <strong>{line.roundCode}</strong> · Horário: {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(line.resultAt))}</p>
          <p>Número sorteado: <strong>{line.resultNumber ?? "Aguardando"}</strong></p>
          <p>Valor apostado neste número: <strong>{money(line.stakeCents)}</strong> · Total da rodada: {money(line.participationTotalCents)} · Total do recibo: {money(line.purchaseTotalCents)}</p>
          {!line.roundCompleted ? <span>Aguardando resultado</span> : line.prizeCents > 0 ? <div><p>Acerto: <strong>{line.prizeCategoryLabel ?? "Não identificado"}</strong></p><p>Valor aplicado na modalidade: {line.categoryStakeCents === null ? "Indisponível" : money(line.categoryStakeCents)} · Multiplicador: {line.multiplier === null ? "Indisponível" : line.multiplier + "x"}</p><p>Prêmio: <strong>{money(line.prizeCents)}</strong></p>{!line.calculationConsistent && <p role="alert" style={{ color: "#ffb4a9", fontWeight: 700 }}>REVISÃO NECESSÁRIA: cálculo divergente. Não entregue o prêmio até a conferência da administração.</p>}</div> : <span>Não premiado</span>}
          {line.paid && <p><strong>PRÊMIO JÁ PAGO</strong> — {line.payoutChannel === "CASHIER_CASH" ? "dinheiro pelo cambista" : line.payoutChannel === "WALLET" ? "crédito na carteira do jogador" : "Pix pela plataforma"}</p>}
        </div>
        {line.roundCompleted && line.prizeCents > 0 && !line.paid && <button type="button" onClick={() => void pay(line.id)} disabled={Boolean(busyLine) || !line.calculationConsistent}>{busyLine === line.id ? "Registrando…" : line.calculationConsistent ? "Registrar dinheiro entregue" : "Pagamento bloqueado — conferir cálculo"}</button>}
      </article>)}
    </div>}
  </section>;
}
