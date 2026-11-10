"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export function CashierSettlementActions({ cashierId }: { cashierId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function settle() {
    if (!window.confirm("Registrar o acerto deste cambista e iniciar um novo período? O fechamento incluirá as vendas, a comissão e os prêmios pagos em dinheiro pelo cambista, para conferência e reposição do caixa. O histórico será preservado.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/cashiers/" + encodeURIComponent(cashierId) + "/settlements", {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível registrar o acerto.");
      const item = body.settlement;
      setNotice("Acerto registrado: " + money(item.totalSalesCents) + " em " + item.salesCount + " vendas; " + item.cashPrizePayoutCount + " prêmios pagos em dinheiro (" + money(item.cashPrizePayoutCents) + ") incluídos no acerto. O histórico foi preservado.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao registrar o acerto.");
    } finally { setBusy(false); }
  }

  return <section className="feature-card admin-settlement-action">
    <h2>Acerto financeiro</h2>
    <p>O acerto inclui vendas, comissão e valores de prêmios pagos em dinheiro pelo cambista. Esses prêmios são adiantamentos de recursos da plataforma, não comissão nem despesa do cambista; o valor fica discriminado para reposição do caixa. Nenhum histórico é apagado.</p>
    <button type="button" className="primary-button" disabled={busy} onClick={settle}>{busy ? "Registrando…" : "Registrar acerto e iniciar novo período"}</button>
    {error && <p role="alert" className="form-error">{error}</p>}
    {notice && <p role="status" className="note-inline">{notice}</p>}
  </section>;
}
