"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Round = {
  id: string; code: string; startsAt: string; cutoffAt: string; resultAt: string;
  status: "SCHEDULED" | "OPEN" | "CLOSED" | "COMPLETED" | "CANCELLED";
  resultNumber: string | null; participationCount: number;
};
type Dashboard = { rounds: Round[]; summary: { pendingPayments: number; confirmedPurchases: number } };
const formatDate = (value: string) => {
  const date = new Date(value);
  const dateLabel = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "Etc/GMT+3" }).format(date);
  const timeLabel = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Etc/GMT+3" }).format(date);
  return `${dateLabel} ${timeLabel}`;
};
const statusLabels: Record<Round["status"], string> = {
  SCHEDULED: "Programada", OPEN: "Aberta", CLOSED: "Fechada", COMPLETED: "Resultado publicado", CANCELLED: "Cancelada",
};

export function AdminRoundManager() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loadController = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setError("");
    try {
      const response = await fetch("/api/admin/rounds", { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível carregar as rodadas.");
      if (!controller.signal.aborted) setData(body as Dashboard);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Falha ao carregar o painel.");
    } finally {
      if (loadController.current === controller) { loadController.current = null; setLoading(false); }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => { window.clearTimeout(timer); loadController.current?.abort(); };
  }, [load]);

  async function perform(round: Round, action: "close" | "draw") {
    const labels = { close: "fechar as apostas desta rodada", draw: "sortear o número desta rodada" };
    if (!window.confirm("Confirma " + labels[action] + " " + round.code + "?")) return;
    setBusy(round.id + action); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/rounds/" + encodeURIComponent(round.id) + "/" + action, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "A operação não foi concluída.");
      setNotice(action === "close" ? "Rodada fechada." : "Número sorteado e publicado.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao executar a operação.");
    } finally { setBusy(null); }
  }

  return <section className="feature-card" aria-labelledby="admin-rounds-heading">
    <span className="feature-label">Operação</span>
    <h2 id="admin-rounds-heading">Rodadas e resultados</h2>
    <p>As ações são verificadas novamente no servidor. O sorteio único de cinco algarismos só fica disponível após o fechamento e no horário programado; a apuração usa o resultado oficial da rodada.</p>


    <div className="form-feedback-slot" aria-live="polite">
      {error && <p role="alert" className="note-inline form-feedback-error" aria-live="assertive">{error}</p>}
      {notice && <p role="status" className="note-inline form-feedback-success" aria-live="polite">{notice}</p>}
    </div>
    {data && <div className="round-options">
      <article className="round-option"><strong>{data.summary.pendingPayments}</strong><br />Compras aguardando pagamento</article>
      <article className="round-option"><strong>{data.summary.confirmedPurchases}</strong><br />Compras confirmadas</article>
    </div>}
    {loading ? <p>Carregando rodadas…</p> : !data || data.rounds.length === 0 ? <p>Não há rodadas cadastradas.</p> : <div className="admin-round-list">
      {data.rounds.map((round) => <article className="round-option" key={round.id}>
        <div><strong>{round.code}</strong> · {statusLabels[round.status]}</div>
        <p>Início: {formatDate(round.startsAt)} · Fechamento: {formatDate(round.cutoffAt)} · Resultado: {formatDate(round.resultAt)}</p>
        <p>Participações registradas: {round.participationCount}</p>
        {round.resultNumber && <div className="round-option"><small>Resultado oficial</small><strong className="numeric-round-result">{round.resultNumber}</strong></div>}
        
        <div className="round-options">
          {(round.status === "SCHEDULED" || round.status === "OPEN") && <button type="button" disabled={busy !== null} onClick={() => void perform(round, "close")}>{busy === round.id + "close" ? "Fechando…" : "Fechar apostas"}</button>}
          {round.status === "CLOSED" && <button type="button" disabled={busy !== null} onClick={() => void perform(round, "draw")}>{busy === round.id + "draw" ? "Sorteando…" : "Sortear número"}</button>}
          
        </div>
      </article>)}
    </div>}
    <button type="button" className="secondary-button" disabled={loading || busy !== null} onClick={() => void load()}>Atualizar painel</button>
  </section>;
}
