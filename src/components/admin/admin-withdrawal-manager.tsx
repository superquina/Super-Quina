"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Item = {
  id: string; username: string; amountCents: number;
  status: "PENDING" | "APPROVED" | "PROCESSING" | "PAID" | "REJECTED";
  pixKey: string | null; pixKeyMasked: string; providerRef: string | null;
  createdAt: string; updatedAt: string; reviewedBy: string | null;
  statusHistory: Array<{ fromStatus: string | null; toStatus: string; note: string | null; createdAt: string; actor: string }>;
};
const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const dateTime = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo", hourCycle: "h23" }).format(new Date(value));
const labels: Record<Item["status"], string> = { PENDING: "Pendente — conferir e pagar Pix", APPROVED: "Estado antigo — requer conferência", PROCESSING: "Estado antigo — requer conferência", PAID: "Pago", REJECTED: "Recusado / reserva liberada" };

export function AdminWithdrawalManager() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loadController = useRef<AbortController | null>(null);
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setError("");
    try {
      const response = await fetch("/api/admin/withdrawals", { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível consultar os saques.");
      if (!controller.signal.aborted) setItems(body.items);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Falha ao consultar os saques.");
    } finally {
      if (loadController.current === controller) { loadController.current = null; setLoading(false); }
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => { window.clearTimeout(timer); loadController.current?.abort(); }; }, [load]);

  async function act(item: Item, action: "mark-paid" | "reject") {
    const note = action === "mark-paid"
      ? "Administrador confirmou a transferência Pix manual. Saque aprovado, pago e encerrado."
      : rejectionReasons[item.id]?.trim() ?? "";
    if (action === "reject" && note.length < 4) {
      setError("Informe o motivo da recusa para registrar na auditoria e mostrar ao jogador.");
      return;
    }
    setBusy(item.id); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/withdrawals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ withdrawalId: item.id, action, note }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível atualizar o saque.");
      setRejectionReasons((current) => { const next = { ...current }; delete next[item.id]; return next; });
      setNotice(action === "mark-paid"
        ? `Saque de ${money(body.withdrawal.amountCents)} de ${body.withdrawal.username} marcado como pago após confirmação do Pix.`
        : `Saque recusado. A reserva de ${money(body.withdrawal.amountCents)} foi liberada na carteira do jogador.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao atualizar o saque."); }
    finally { setBusy(null); }
  }

  const pending = items.filter((item) => item.status === "PENDING");
  const history = items.filter((item) => item.status !== "PENDING");

  return <section className="feature-card" aria-labelledby="admin-withdrawals-heading">
    <span className="feature-label">Financeiro</span>
    <h2 id="admin-withdrawals-heading">Saques das carteiras digitais</h2>
    <p>Confira os dados e realize o Pix manualmente. Depois da transferência, clique em “Aprovar e concluir” para encerrar o saque em uma única operação. Se a chave estiver inválida, informe o motivo e clique em “Recusar e devolver saldo”. O sistema não envia Pix automaticamente.</p>
    {error && <p role="alert" className="note-inline">{error}</p>}
    {notice && <p role="status" className="note-inline">{notice}</p>}
    {loading ? <p>Carregando solicitações…</p> : pending.length === 0 ? <p>Não há saques pendentes.</p> : <div className="admin-round-list">
      {pending.map((item) => <article className="round-option" key={item.id}>
        <div><strong>{item.username}</strong> · {money(item.amountCents)} · {labels[item.status]}</div>
        <p>Solicitado em {dateTime(item.createdAt)}</p>
        <p>Chave Pix para pagamento: <strong>{item.pixKey ?? item.pixKeyMasked}</strong></p>
        <label>Motivo da recusa (obrigatório se recusar)<textarea value={rejectionReasons[item.id] ?? ""} onChange={(event) => setRejectionReasons((current) => ({ ...current, [item.id]: event.target.value }))} maxLength={500} rows={2} placeholder="Ex.: chave Pix inválida ou não localizada." /></label>
        <div className="round-options">
          <button type="button" disabled={busy !== null} onClick={() => void act(item, "mark-paid")}>{busy === item.id ? "Concluindo…" : "Aprovar e concluir"}</button>
          <button type="button" className="secondary-button" disabled={busy !== null || (rejectionReasons[item.id]?.trim().length ?? 0) < 4} onClick={() => void act(item, "reject")}>Recusar e devolver saldo</button>
        </div>
      </article>)}
    </div>}
    <h3>Histórico de saques</h3>
    {loading ? <p>Carregando histórico…</p> : history.length === 0 ? <p>Nenhum saque encerrado.</p> : <div className="admin-round-list">
      {history.map((item) => <article className="round-option" key={item.id}>
        <div><strong>{item.username}</strong> · {money(item.amountCents)} · {labels[item.status]}</div>
        <p>Solicitado em {dateTime(item.createdAt)}{item.providerRef ? " · Referência: " + item.providerRef : ""}</p>
        <p>Revisado por: {item.reviewedBy ?? "—"}</p>
        {item.statusHistory.map((event, index) => <p key={item.id + event.createdAt + index}><small>{dateTime(event.createdAt)} · {event.actor} · {event.note ?? labels[event.toStatus as Item["status"]]}</small></p>)}
      </article>)}
    </div>}
    <button type="button" className="secondary-button" disabled={loading || busy !== null} onClick={() => void load()}>Atualizar saques</button>
  </section>;
}
