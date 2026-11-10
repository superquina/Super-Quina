"use client";

import { useCallback, useEffect, useState } from "react";

type Winner = {
  id: string;
  numberValue: string;
  prizeCents: number;
  stakeCents: number;
  prizeCategory: string | null;
  prizeCategoryLabel: string | null;
  categoryStakeCents: number | null;
  multiplier: number | null;
  calculatedPrizeCents: number | null;
  calculationConsistent: boolean;
  participationTotalCents: number;
  purchaseTotalCents: number;
  roundCode: string;
  resultNumber: string | null;
  resultAt: string;
  receiptCode: string | null;
  playerName: string;
  phone: string | null;
  cashierName: string | null;
  manualEligible: boolean;
  paid: boolean;
  payoutChannel: "PLATFORM_PIX" | "CASHIER_CASH" | "WALLET" | null;
  paidAt: string | null;
  reference: string | null;
};

const money = (cents: number) => new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL",
}).format(cents / 100);
const dateTime = (value: string) => new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo",
}).format(new Date(value));

export function AdminPrizePayout() {
  const [winners, setWinners] = useState<Winner[]>([]);
  const [references, setReferences] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"pending" | "paid">("pending");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/prizes/pending", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível carregar os ganhadores.");
      setWinners(body.winners as Winner[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao carregar os ganhadores.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/admin/prizes/pending", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Não foi possível carregar os ganhadores.");
        if (active) setWinners(body.winners as Winner[]);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Falha ao carregar os ganhadores.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  async function confirmPaid(winner: Winner) {
    if (!window.confirm(
      "Confirma que você já fez o Pix de " + money(winner.prizeCents) +
      " para " + winner.playerName + " e conferiu o comprovante?"
    )) return;

    setBusy(winner.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/prizes/" + encodeURIComponent(winner.id) + "/payout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reference: references[winner.id]?.trim() || undefined }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível registrar o pagamento.");
      setWinners((current) => current.map((item) =>
        item.id === winner.id
          ? { ...item, paid: true, payoutChannel: "PLATFORM_PIX", paidAt: new Date().toISOString(), reference: references[winner.id]?.trim() || null }
          : item
      ));
      setReferences((current) => ({ ...current, [winner.id]: "" }));
      setNotice("Pix registrado. O ganhador foi movido para o histórico de pagos.");
      setTab("pending");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao registrar o pagamento.");
    } finally {
      setBusy("");
    }
  }

  const pending = winners.filter((winner) => !winner.paid);
  const paid = winners.filter((winner) => winner.paid);
  const visible = tab === "pending" ? pending : paid;
  // Only cashier prizes require an outgoing Pix from the administrator.
  const manualPending = pending.filter((winner) => winner.manualEligible);
  const totalToPayCents = manualPending.reduce((total, winner) => total + winner.prizeCents, 0);
  const reviewPending = pending.filter((winner) => !winner.manualEligible);
  const reviewTotalCents = reviewPending.reduce((total, winner) => total + winner.prizeCents, 0);

  return <section className="feature-card admin-prize-payout" aria-labelledby="admin-prize-payout-heading">
    <span className="feature-label">Central de pagamentos</span>
    <h2 id="admin-prize-payout-heading">Ganhadores</h2>
    <p>Todos os ganhadores das rodadas concluídas ficam reunidos aqui. Faça o Pix fora da plataforma e confirme somente depois que a transferência estiver concluída.</p>

    {tab === "pending" && <div className="admin-prize-total-panel" style={{
      margin: "1rem 0", padding: "1rem 1.1rem", borderRadius: "16px",
      border: "1px solid rgba(66, 211, 242, .55)",
      background: "linear-gradient(135deg, rgba(0, 139, 190, .24), rgba(22, 35, 57, .96))",
      boxShadow: "0 8px 24px rgba(0, 0, 0, .18)",
    }}>
      <span style={{ display: "block", fontSize: ".8rem", fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "#62d8f4" }}>
        Total de Pix a pagar
      </span>
      <strong style={{ display: "block", marginTop: ".2rem", fontSize: "clamp(1.7rem, 6vw, 2.2rem)", lineHeight: 1.1, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
        {money(totalToPayCents)}
      </strong>
      <span style={{ display: "block", marginTop: ".35rem", color: "#c5d2e4", fontSize: ".85rem" }}>
        {manualPending.length} {manualPending.length === 1 ? "prêmio aguardando Pix" : "prêmios aguardando Pix"}
      </span>
      {reviewPending.length > 0 && <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid rgba(255,255,255,.16)" }}>
        <strong style={{ color: "#ffd27a" }}>Em conferência: {money(reviewTotalCents)}</strong>
        <span style={{ display: "block", marginTop: ".25rem", color: "#c5d2e4" }}>
          {reviewPending.length} {reviewPending.length === 1 ? "prêmio" : "prêmios"} com crédito automático ainda não confirmado. Não estão incluídos no total de Pix manual.
        </span>
      </div>}
    </div>}

    <div className="round-options admin-prize-tabs" role="group" aria-label="Filtrar ganhadores">
      <button type="button" className={"admin-prize-tab" + (tab === "pending" ? " is-active" : "")} onClick={() => setTab("pending")}>
        A pagar ({pending.length})
      </button>
      <button type="button" className={"admin-prize-tab" + (tab === "paid" ? " is-active" : "")} onClick={() => setTab("paid")}>
        Já pagos ({paid.length})
      </button>
      <button type="button" className="admin-prize-refresh" disabled={loading} onClick={() => { setLoading(true); setError(""); void load(); }}>
        Atualizar
      </button>
    </div>

    {error && <p role="alert" className="note-inline">{error}</p>}
    {notice && <p role="status" className="note-inline">{notice}</p>}
    {loading ? <p>Carregando ganhadores…</p> : visible.length === 0
      ? <p>{tab === "pending" ? "Nenhum pagamento pendente." : "Nenhum prêmio pago registrado ainda."}</p>
      : <div className="admin-round-list">
        {visible.map((winner) => <article className="round-option admin-prize-card" key={winner.id}>
          <strong>{winner.playerName}</strong>
          <p><strong>Prêmio: {money(winner.prizeCents)}</strong> · Acerto: <strong>{winner.prizeCategoryLabel ?? "Não identificado"}</strong></p>
          <p>Número apostado: <strong>{winner.numberValue}</strong> · Número sorteado: <strong>{winner.resultNumber ?? "Indisponível"}</strong></p>
          <p>Rodada: {winner.roundCode} · Data e horário do sorteio: {dateTime(winner.resultAt)}</p>
          <p>Valor desta aposta: <strong>{money(winner.stakeCents)}</strong> · Total da rodada nesta compra: {money(winner.participationTotalCents)} · Total do recibo: {money(winner.purchaseTotalCents)}</p>
          <p>Valor aplicado em {winner.prizeCategoryLabel ?? "modalidade"}: {winner.categoryStakeCents === null ? "Indisponível" : money(winner.categoryStakeCents)} · Multiplicador registrado: {winner.multiplier === null ? "Indisponível" : winner.multiplier + "x"}</p>
          <p>Recibo: {winner.receiptCode ?? "—"} {winner.cashierName ? " · Cambista: " + winner.cashierName : ""}</p>
          {!winner.calculationConsistent && <p role="alert" style={{ color: "#ffb4a9", fontWeight: 700 }}>REVISÃO NECESSÁRIA: o prêmio registrado não confere com o recálculo usando o valor apostado e a regra salva. Não efetue o pagamento até investigar.</p>}
          {winner.phone && <p>Telefone: {winner.phone}</p>}
          {winner.paid
            ? <p><strong>{winner.payoutChannel === "WALLET" ? "CRÉDITO NA CARTEIRA" : "PIX PAGO"}</strong>{winner.paidAt ? " · " + dateTime(winner.paidAt) : ""}{winner.reference ? " · Ref.: " + winner.reference : ""}</p>
            : <>
              {winner.manualEligible ? <>
                <label htmlFor={"winner-reference-" + winner.id}>Referência do comprovante (opcional)</label>
                <input className="admin-prize-reference" id={"winner-reference-" + winner.id} value={references[winner.id] ?? ""}
                  onChange={(event) => setReferences((current) => ({ ...current, [winner.id]: event.target.value }))} maxLength={300}
                  placeholder="Identificador do Pix" />
                <button className="admin-prize-confirm" type="button" disabled={Boolean(busy) || !winner.calculationConsistent} onClick={() => void confirmPaid(winner)}>
                  {busy === winner.id ? "Registrando…" : winner.calculationConsistent ? "Confirmar Pix pago" : "Pagamento bloqueado — conferir cálculo"}
                </button>
              </> : <p role="alert">Crédito automático ainda não confirmado. Conferir este prêmio.</p>}
            </>}
        </article>)}
      </div>}
  </section>;
}
