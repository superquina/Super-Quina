"use client";
import { FormEvent, useState } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
type TicketResult = { id: string; numberValue: string; resultNumber: string | null; roundCode: string; resultAt: string; roundStatus: string; status: "PREMIADA" | "NAO_PREMIADA" | "AGUARDANDO_RESULTADO" | "AGUARDANDO_APURACAO" | "PRAZO_EXPIRADO"; prizeCents: number | null };
type LookupResponse = { found?: boolean; results?: TicketResult[]; message?: string; error?: string };
const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const resultLabels: Record<TicketResult["status"], string> = { PREMIADA: "Prêmio creditado", PRAZO_EXPIRADO: "Prazo de resgate do prêmio expirado", NAO_PREMIADA: "Não premiada", AGUARDANDO_RESULTADO: "Aguardando resultado", AGUARDANDO_APURACAO: "Resultado publicado; apuração pendente" };
const time = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Sao_Paulo" }).format(new Date(value));
export default function ConsultaPage() {
  const [code, setCode] = useState(""); const [results, setResults] = useState<TicketResult[]>([]);
  const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(""); setMessage(""); setResults([]);
    try {
      const response = await fetch("/api/public/ticket-check?q=" + encodeURIComponent(code.trim()), { cache: "no-store" });
      const body = await response.json() as LookupResponse;
      if (!response.ok) throw new Error(body.error ?? "Não foi possível consultar o recibo.");
      setResults(body.results ?? []); setMessage(body.message ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível consultar o recibo."); }
    finally { setLoading(false); }
  }
  return <main className="page-shell site-page-shell">
    <SiteHeader />
    <section className="feature-card" aria-labelledby="ticket-check-heading">
      <span className="feature-label">Consulta pública</span>
      <h1 id="ticket-check-heading">Consultar recibo e resultados</h1>
      <p>Digite o código completo do recibo iniciado por SQ-. A consulta de números e resultados fica disponível por 7 dias a partir da compra. Depois desse prazo, o recibo vence e não pode ser consultado nem reimpresso. <Link href="/termos-de-uso">Leia os termos de uso</Link>.</p>
      <form onSubmit={submit} className="purchase-form">
        <label htmlFor="receipt-code">Código do recibo</label>
        <input id="receipt-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="SQ-12345678" minLength={11} maxLength={35} autoComplete="off" required />
        <button type="submit" disabled={loading}>{loading ? "Consultando…" : "Consultar recibo"}</button>
      </form>
      {error && <p className="note-inline" role="alert">{error}</p>}
      {message && <p className="note-inline" role="status">{message}</p>}
      {results.length > 0 && <div className="player-history-list">
        {results.map((result) => <article className="player-history-purchase" key={result.id}>
          <div className="player-history-round-heading"><strong>Rodada {result.roundCode}</strong><span>{time(result.resultAt)}</span></div>
          <div className="player-history-line">
            <strong className="numeric-number-chip">{result.numberValue}</strong>
            <div className="player-history-line-detail">
              <strong>{resultLabels[result.status]}</strong>
              {result.prizeCents !== null && <span className="player-history-prize">{money(result.prizeCents)}</span>}
            </div>
          </div>
          {result.roundStatus === "COMPLETED" && result.resultNumber && <div className="player-history-draw-results">
            <div><span>Número sorteado</span><strong className="numeric-round-result">{result.resultNumber}</strong></div>
          </div>}
        </article>)}
      </div>}
    </section>
  </main>;
}
