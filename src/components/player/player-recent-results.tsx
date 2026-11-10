"use client";

import { useEffect, useState } from "react";

type DrawResult = { id: string; code: string; resultAt: string; number: string };
function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function PlayerRecentResults() {
  const [results, setResults] = useState<DrawResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/player/results", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Não foi possível carregar os resultados.");
        return body.results as DrawResult[];
      })
      .then((items) => { if (active) setResults(items); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Erro ao carregar resultados."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return (
    <div className="recent-results-content">
      {loading ? <p>Carregando sorteios…</p> : error ? <p role="alert" className="note-inline">{error}</p> : results.length === 0 ? (
        <p>Ainda não há sorteios publicados nas últimas 24 horas.</p>
      ) : <div className="recent-results-list">{results.slice(0, 48).map((result) => (
        <article className="recent-result" key={result.id}>
          <div className="recent-result-heading"><strong>Rodada {result.code}</strong><time dateTime={result.resultAt}>{formatDate(result.resultAt)}</time></div>
          <div className="numeric-result-display" aria-label={"Número sorteado: " + result.number}>{result.number}</div>
        </article>
      ))}</div>}
    </div>
  );
}
