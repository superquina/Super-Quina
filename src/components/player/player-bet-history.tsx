"use client";
import { useEffect, useState } from "react";
type HistoryLine = { id: string; numberValue: string; resultStatus: "PREMIADA" | "NAO_PREMIADA" | "AGUARDANDO_RESULTADO" | "AGUARDANDO_APURACAO" | "COMPRA_PENDENTE"; prizeCents: number | null };
type Participation = { id: string; status: string; totalCents: number; roundCode: string; roundStatus: string; resultAt: string; resultNumber: string | null; lines: HistoryLine[] };
type HistoryPurchase = { id: string; purchaseStatus: string; createdAt: string; totalCents: number; participations: Participation[] };
const labels: Record<HistoryLine["resultStatus"], string> = { PREMIADA: "PREMIADA", NAO_PREMIADA: "NÃO PREMIADA", AGUARDANDO_RESULTADO: "AGUARDANDO SORTEIO", AGUARDANDO_APURACAO: "AGUARDANDO APURAÇÃO", COMPRA_PENDENTE: "COMPRA AINDA NÃO CONFIRMADA" };
const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const date = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
export function PlayerBetHistory() {
  const [history, setHistory] = useState<HistoryPurchase[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/player/history", { cache: "no-store" }).then(async (response) => {
      const body = await response.json() as { history?: HistoryPurchase[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Não foi possível carregar seu histórico.");
      return body.history ?? [];
    }).then((items) => { if (active) setHistory(items); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Erro ao carregar seu histórico."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return <section className="feature-card player-history-card" aria-labelledby="player-history-heading">
    <span className="feature-label">Suas apostas</span><h2 id="player-history-heading">Histórico de apostas</h2>
    <p>Consulte seus números, rodadas e prêmios.</p>
    {loading ? <p>Carregando seu histórico…</p> : error ? <p className="note-inline" role="alert">{error}</p> : history.length === 0 ? <p>Você ainda não tem apostas registradas neste período.</p> : (
      <div className="player-history-list">{history.map((purchase) => <article className="player-history-purchase" key={purchase.id}>
        <div className="player-history-purchase-heading"><div><strong>Compra realizada</strong><span>{date(purchase.createdAt)}</span></div><strong>{money(purchase.totalCents)}</strong></div>
        {purchase.purchaseStatus !== "CONFIRMED" && <p className="player-history-pending">Compra: {purchase.purchaseStatus === "PENDING_PAYMENT" ? "aguardando pagamento" : purchase.purchaseStatus === "CANCELLED" ? "cancelada" : "estornada"}.</p>}
        {purchase.participations.map((part) => <section className="player-history-round" key={part.id}>
          <div className="player-history-round-heading"><strong>Rodada {part.roundCode}</strong><span>{part.roundStatus === "COMPLETED" ? "Sorteio concluído" : part.roundStatus === "CANCELLED" ? "Rodada cancelada" : "Em andamento"}</span></div>
          <div className="player-history-lines">{part.lines.map((line) => <div className={"player-history-line " + (line.resultStatus === "PREMIADA" ? "is-credited" : "")} key={line.id}>
            <strong className="numeric-number-chip">{line.numberValue}</strong>
            <div className="player-history-line-detail"><strong className={"player-history-status status-" + line.resultStatus.toLowerCase()}>{labels[line.resultStatus]}</strong>
              {line.resultStatus === "PREMIADA" && line.prizeCents !== null && <span className="player-history-prize">{money(line.prizeCents)}</span>}</div>
          </div>)}</div>
          {part.roundStatus === "COMPLETED" && part.resultNumber && <div className="player-history-draw-results"><div><span>Número sorteado</span><strong className="numeric-round-result">{part.resultNumber}</strong></div></div>}
        </section>)}
      </article>)}</div>
    )}
  </section>;
}
