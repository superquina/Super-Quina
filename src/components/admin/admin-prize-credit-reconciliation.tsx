"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PendingCredit = {
  lineId: string;
  numberValue: string;
  prizeCents: number;
  roundCode: string;
  resultAt: string;
  purchaseCreatedAt: string;
  playerId: string | null;
  username: string;
  ledgerEntryExists: boolean;
  ledgerMatches: boolean;
};

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const dateTime = (value: string) => new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo", hourCycle: "h23",
}).format(new Date(value));

export function AdminPrizeCreditReconciliation() {
  const [items, setItems] = useState<PendingCredit[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
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
      const response = await fetch("/api/admin/prize-credit-reconciliation", { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível consultar os créditos pendentes.");
      if (!controller.signal.aborted) setItems(body.items as PendingCredit[]);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Falha ao carregar os créditos pendentes.");
    } finally {
      if (loadController.current === controller) { loadController.current = null; setLoading(false); }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => { window.clearTimeout(timer); loadController.current?.abort(); };
  }, [load]);

  async function repair(item: PendingCredit) {
    const reason = (reasons[item.lineId] ?? "").trim();
    if (reason.length < 8) {
      setError("Registre um motivo detalhado com pelo menos 8 caracteres antes de corrigir o crédito.");
      return;
    }
    if (!window.confirm(`Confirma verificar e corrigir o prêmio de ${money(item.prizeCents)} para ${item.username}, referente à rodada ${item.roundCode}? O sistema verificará o livro-razão e não duplicará um crédito existente.`)) return;
    setBusy(item.lineId); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/prize-credit-reconciliation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineId: item.lineId, reason }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível corrigir o crédito.");
      setNotice(body.creditedNow
        ? `Crédito corretivo de ${money(body.prizeCents)} registrado na carteira de ${body.player} para a rodada ${body.roundCode}.`
        : `Registro financeiro existente de ${money(body.prizeCents)} reconciliado para ${body.player}; nenhum segundo crédito foi criado.`);
      setReasons((current) => ({ ...current, [item.lineId]: "" }));
      await load();
    } catch (reasonError) {
      setError(reasonError instanceof Error ? reasonError.message : "Falha ao corrigir o crédito.");
    } finally { setBusy(null); }
  }

  return <section className="feature-card" aria-labelledby="admin-prize-reconciliation-heading">
    <span className="feature-label">Carteira digital</span>
    <h2 id="admin-prize-reconciliation-heading">Corrigir créditos de prêmios online</h2>
    <p>Esta ferramenta procura prêmios positivos de jogadores online em rodadas concluídas cujo registro no livro-razão esteja ausente ou divergente, ou cuja marcação de crédito esteja incompleta. Prêmios já pagos por outro canal não aparecem para correção. O prazo de sete dias não se aplica a falhas técnicas de crédito online. Cada correção recalcula o prêmio com as regras históricas, verifica o livro-razão e registra auditoria; divergências são bloqueadas.</p>
    <p className="note-inline">Use apenas para falhas técnicas confirmadas. Prêmios manuais de vendas de cambista não aparecem nesta lista.</p>
    {error && <p role="alert" className="note-inline">{error}</p>}
    {notice && <p role="status" className="note-inline">{notice}</p>}
    {loading ? <p>Consultando créditos pendentes…</p> : items.length === 0 ? <p>Não há créditos corretivos pendentes identificados no momento.</p> : <div className="admin-round-list">
      {items.map((item) => <article className="round-option" key={item.lineId}>
        <div><strong>{item.username}</strong> · {money(item.prizeCents)}</div>
        <p>Rodada: {item.roundCode} · Resultado: {dateTime(item.resultAt)}</p>
        <p>Compra: {dateTime(item.purchaseCreatedAt)} · Número: {item.numberValue}</p>
        {item.ledgerEntryExists && !item.ledgerMatches
          ? <p role="alert" className="note-inline">Divergência no livro-razão. A correção está bloqueada e exige auditoria.</p>
          : item.ledgerEntryExists
            ? <p>Existe lançamento financeiro compatível; a ação apenas reconciliará o registro sem duplicar o crédito.</p>
            : <p>Não foi localizado o lançamento idempotente esperado para este prêmio.</p>}
        <label>Motivo e referência da verificação
          <textarea rows={3} maxLength={500} value={reasons[item.lineId] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [item.lineId]: event.target.value }))} placeholder="Ex.: falha de crédito confirmada ao revisar a apuração e o livro-razão." />
        </label>
        <button type="button" disabled={busy !== null || (item.ledgerEntryExists && !item.ledgerMatches)} onClick={() => void repair(item)}>
          {busy === item.lineId ? "Verificando e corrigindo…" : item.ledgerEntryExists ? "Reconciliar lançamento" : "Corrigir crédito na carteira"}
        </button>
      </article>)}
    </div>}
    <button type="button" className="secondary-button" disabled={loading || busy !== null} onClick={() => void load()}>Atualizar créditos pendentes</button>
  </section>;
}
