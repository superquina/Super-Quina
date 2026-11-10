"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Summary = {
  cashSalesCents: number;
  pixSalesCents: number;
  totalSalesCents: number;
  gamesCount: number;
  commissionCents: number;
  cashPrizePayoutCents: number;
  cashPrizePayoutCount: number;
  lastSettlementAt: string | null;
};

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export function CashierSalesSummary() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const loadingRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetch("/api/cashier/summary", { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível consultar o resumo.");
      if (!controller.signal.aborted && requestRef.current === controller) {
        setSummary(body as Summary);
        setError("");
      }
    } catch (reason) {
      if (!controller.signal.aborted && requestRef.current === controller) {
        setError(reason instanceof Error ? reason.message : "Falha ao consultar o resumo.");
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        loadingRef.current = false;
      }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    const interval = window.setInterval(() => { void load(); }, 30000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      requestRef.current?.abort();
      requestRef.current = null;
      loadingRef.current = false;
    };
  }, [load]);

  return <details className="player-collapsible-section cashier-summary-menu">
    <summary>
      <span className="player-collapsible-label">Financeiro</span>
      <span className="player-collapsible-title">Resumo financeiro</span>
    </summary>
    <section className="cashier-compact-summary" aria-label="Resumo financeiro do cambista">
      {error && <p role="alert" className="note-inline">{error}</p>}
      <div className="cashier-summary-grid">
        <article className="cashier-summary-tile"><span>Comissão acumulada</span><strong>{summary ? money(summary.commissionCents) : "Carregando…"}</strong></article>
        <article className="cashier-summary-tile"><span>Valor total das vendas</span><strong>{summary ? money(summary.totalSalesCents) : "Carregando…"}</strong></article>
        <article className="cashier-summary-tile"><span>Vendas em dinheiro</span><strong>{summary ? money(summary.cashSalesCents) : "Carregando…"}</strong></article>
        <article className="cashier-summary-tile"><span>Vendas em Pix</span><strong>{summary ? money(summary.pixSalesCents) : "Carregando…"}</strong></article>
        <article className="cashier-summary-tile"><span>Jogos realizados</span><strong>{summary ? summary.gamesCount.toLocaleString("pt-BR") : "Carregando…"}</strong></article>
        <article className="cashier-summary-tile"><span>Prêmios pagos pelo cambista</span><strong>{summary ? money(summary.cashPrizePayoutCents) : "Carregando…"}</strong><small>{summary ? summary.cashPrizePayoutCount.toLocaleString("pt-BR") + " pagamentos" : ""}</small></article>
      </div>
      {summary?.lastSettlementAt && <p className="note-inline">Último acerto: {new Date(summary.lastSettlementAt).toLocaleString("pt-BR")}</p>}
    </section>
  </details>;
}
