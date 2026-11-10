import Link from "next/link";
import { notFound } from "next/navigation";
import { AreaShell } from "@/components/area-shell";
import { CashierSettlementActions } from "@/components/admin/cashier-settlement-actions";
import { requireRole } from "@/lib/auth/require-role";
import { authPrisma } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;
const pageNumber = (value: string | string[] | undefined) => {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
};
const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export default async function AdminCashierDetailPage({ params, searchParams }: { params: Promise<{ cashierId: string }>; searchParams: Promise<{ salesPage?: string | string[]; settlementsPage?: string | string[] }> }) {
  const admin = await requireRole("ADMIN");
  const { cashierId } = await params;
  const query = await searchParams;
  const salesPage = pageNumber(query.salesPage);
  const settlementsPage = pageNumber(query.settlementsPage);
  const cashier = await authPrisma.user.findFirst({
    where: { id: cashierId, role: "CASHIER" },
    select: { id: true, username: true, fullName: true, whatsapp: true, city: true, address: true, referencePoint: true, status: true, commissionRateBasisPoints: true, createdAt: true },
  });
  if (!cashier) notFound();
  const latestSettlement = await authPrisma.cashierSettlement.findFirst({ where: { cashierId }, orderBy: { settledAt: "desc" }, select: { settledAt: true } });
  const since = latestSettlement?.settledAt ?? new Date(0);
  const [purchases, settlements, purchaseCount, settlementCount, cashNow, pixNow, commissionNow, gamesNow, cashPrizePayouts] = await Promise.all([
    authPrisma.purchase.findMany({
      where: { cashierId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (salesPage - 1) * PAGE_SIZE, take: PAGE_SIZE,
      select: {
        id: true, receiptCode: true, status: true, paymentMethod: true, totalCents: true, createdAt: true, confirmedAt: true,
        customer: { select: { name: true, phone: true } },
        payment: { select: { status: true, confirmedAt: true } },
        commission: { select: { amountCents: true, rateBasisPoints: true } },
        participations: { select: { id: true, round: { select: { code: true } }, numericLines: { select: { id: true } } } },
      },
    }),
    authPrisma.cashierSettlement.findMany({
      where: { cashierId }, orderBy: [{ settledAt: "desc" }, { id: "desc" }], skip: (settlementsPage - 1) * PAGE_SIZE, take: PAGE_SIZE,
      select: {
        id: true, settledAt: true, cashSalesCents: true, pixSalesCents: true,
        totalSalesCents: true, salesCount: true, gamesCount: true,
        commissionCents: true, cashPrizePayoutCount: true, cashPrizePayoutCents: true,
        cashPrizePayouts: {
          select: {
            id: true, amountCents: true, paidAt: true, reference: true,
            participationLine: {
              select: {
                numberValue: true,
                participation: {
                  select: {
                    purchase: { select: { receiptCode: true } },
                    round: { select: { code: true } },
                  },
                },
              },
            },
          },
        },
        admin: { select: { username: true } },
      },
    }),
    authPrisma.purchase.count({ where: { cashierId } }),
    authPrisma.cashierSettlement.count({ where: { cashierId } }),
    authPrisma.purchase.aggregate({ where: { cashierId, status: "CONFIRMED", paymentMethod: "CASH", confirmedAt: { gt: since } }, _sum: { totalCents: true }, _count: { _all: true } }),
    authPrisma.purchase.aggregate({ where: { cashierId, status: "CONFIRMED", paymentMethod: "PIX", confirmedAt: { gt: since }, payment: { is: { status: "CONFIRMED" } } }, _sum: { totalCents: true }, _count: { _all: true } }),
    authPrisma.cashierCommission.aggregate({ where: { cashierId, purchase: { is: { status: "CONFIRMED", confirmedAt: { gt: since } } } }, _sum: { amountCents: true } }),
    authPrisma.numericParticipationLine.count({ where: { participation: { is: { status: "CONFIRMED", purchase: { is: { cashierId, status: "CONFIRMED", confirmedAt: { gt: since } } } } } } }),
    authPrisma.numericPrizePayout.aggregate({ where: { cashierId, channel: "CASHIER_CASH", settlementId: null, paidAt: { gt: since } }, _sum: { amountCents: true }, _count: { _all: true } }),
  ]);
  const cashTotal = cashNow._sum.totalCents ?? 0;
  const pixTotal = pixNow._sum.totalCents ?? 0;
  const commissionTotal = commissionNow._sum.amountCents ?? 0;
  return <AreaShell title="Financeiro do cambista" username={admin.username} description="Cadastro, vendas e histórico de acertos.">
    <div className="admin-cashier-detail">
      <p><Link href="/admin">← Voltar ao administrador</Link></p>
      <section className="feature-card admin-cashier-current">
        <h2>Resumo financeiro — igual ao painel do cambista</h2>
        <p>Valores acumulados desde o último acerto. Somente vendas confirmadas entram no resumo.</p>
        <div className="cashier-summary-grid">
          <article className="cashier-summary-tile"><span>Comissão acumulada</span><strong>{money(commissionTotal)}</strong></article>
          <article className="cashier-summary-tile"><span>Valor total das vendas</span><strong>{money(cashTotal + pixTotal)}</strong></article>
          <article className="cashier-summary-tile"><span>Vendas em dinheiro</span><strong>{money(cashTotal)}</strong></article>
          <article className="cashier-summary-tile"><span>Vendas em Pix confirmado</span><strong>{money(pixTotal)}</strong></article>
          <article className="cashier-summary-tile"><span>Prêmios pagos pelo cambista ({cashPrizePayouts._count._all})</span><strong>{money(cashPrizePayouts._sum.amountCents ?? 0)}</strong></article>
        </div>
        <p>Vendas confirmadas: {cashNow._count._all + pixNow._count._all} · Jogos realizados: {gamesNow}</p>
        <p>Contagem iniciada em: {latestSettlement ? latestSettlement.settledAt.toLocaleString("pt-BR") : "início das vendas"}</p>
      </section>
      <section className="feature-card">
        <span className="feature-label">Dados do cambista</span>
        <h2>{cashier.fullName || cashier.username}</h2>
        <p>Usuário: {cashier.username} · WhatsApp: {cashier.whatsapp || "Não informado"}</p>
        <p>Cidade: {cashier.city || "Não informada"}</p>
        <p>Endereço: {cashier.address || "Não informado"}</p>
        <p>Ponto de referência: {cashier.referencePoint || "Não informado"}</p>
        <p>Status: {cashier.status === "ACTIVE" ? "Ativo" : cashier.status === "BLOCKED" ? "Bloqueado" : "Pendente"} · Comissão atual: {(cashier.commissionRateBasisPoints / 100).toLocaleString("pt-BR")}%</p>
        <p>Cadastro: {cashier.createdAt.toLocaleString("pt-BR")}</p>
      </section>
      <CashierSettlementActions cashierId={cashier.id} />
      <section className="feature-card admin-cashier-history">
        <h2>Histórico de vendas</h2>
        <p>Vendas pendentes, canceladas e estornadas aparecem no histórico, mas não entram no acerto.</p>
        {purchases.length === 0 ? <p>Nenhuma venda registrada.</p> : <div className="admin-cashier-table-wrap"><table className="admin-cashier-table">
          <thead><tr><th>Data</th><th>Recibo</th><th>Cliente</th><th>Pagamento</th><th>Status</th><th>Valor</th><th>Comissão</th><th>Jogos</th></tr></thead>
          <tbody>{purchases.map((sale) => <tr key={sale.id}>
            <td>{(sale.confirmedAt || sale.createdAt).toLocaleString("pt-BR")}</td>
            <td>{sale.receiptCode || "—"}</td>
            <td>{sale.customer?.name || "—"}</td>
            <td>{sale.paymentMethod === "PIX" ? "Pix" : sale.paymentMethod === "CASH" ? "Dinheiro" : "Carteira"}</td>
            <td>{sale.status === "CONFIRMED" && (sale.paymentMethod !== "PIX" || sale.payment?.status === "CONFIRMED") ? "Confirmada" : sale.status === "PENDING_PAYMENT" ? "Pendente" : sale.status === "REFUNDED" ? "Estornada" : "Cancelada"}</td>
            <td>{money(sale.totalCents)}</td><td>{sale.commission ? money(sale.commission.amountCents) : "—"}</td>
            <td>{sale.participations.reduce((total, participation) => total + participation.numericLines.length, 0)}</td>
          </tr>)}</tbody>
        </table></div>}
        <p className="admin-cashier-pagination">Página {salesPage} de {Math.max(1, Math.ceil(purchaseCount / PAGE_SIZE))} · {purchaseCount} vendas · {salesPage > 1 && <Link href={`?salesPage=${salesPage - 1}&settlementsPage=${settlementsPage}`}>Anterior</Link>} {salesPage * PAGE_SIZE < purchaseCount && <Link href={`?salesPage=${salesPage + 1}&settlementsPage=${settlementsPage}`}>Próxima</Link>}</p>
      </section>
      <section className="feature-card admin-cashier-history">
        <h2>Histórico de acertos</h2>
        {settlements.length === 0 ? <p>Nenhum acerto registrado.</p> : <div className="admin-cashier-table-wrap"><table className="admin-cashier-table">
          <thead><tr><th>Data</th><th>Dinheiro</th><th>Pix</th><th>Total</th><th>Vendas</th><th>Jogos</th><th>Comissão</th><th>Prêmios pagos em dinheiro</th><th>Responsável</th></tr></thead>
          <tbody>{settlements.map((item) => <tr key={item.id}><td>{item.settledAt.toLocaleString("pt-BR")}</td><td>{money(item.cashSalesCents)}</td><td>{money(item.pixSalesCents)}</td><td>{money(item.totalSalesCents)}</td><td>{item.salesCount}</td><td>{item.gamesCount}</td><td>{money(item.commissionCents)}</td><td>{item.cashPrizePayoutCount} · {money(item.cashPrizePayoutCents)}{item.cashPrizePayouts.length > 0 && <details><summary>Ver detalhes</summary><ul>{item.cashPrizePayouts.map((payout) => <li key={payout.id}>{payout.participationLine.numberValue} · {payout.participationLine.participation.round.code} · {money(payout.amountCents)} · {payout.paidAt.toLocaleString("pt-BR")} · Recibo {payout.participationLine.participation.purchase.receiptCode || "—"}{payout.reference ? " · Ref. " + payout.reference : ""}</li>)}</ul></details>}</td><td>{item.admin.username}</td></tr>)}</tbody>
        </table></div>}
        <p className="admin-cashier-pagination">Página {settlementsPage} de {Math.max(1, Math.ceil(settlementCount / PAGE_SIZE))} · {settlementCount} acertos · {settlementsPage > 1 && <Link href={`?salesPage=${salesPage}&settlementsPage=${settlementsPage - 1}`}>Anterior</Link>} {settlementsPage * PAGE_SIZE < settlementCount && <Link href={`?salesPage=${salesPage}&settlementsPage=${settlementsPage + 1}`}>Próxima</Link>}</p>
      </section>
    </div>
  </AreaShell>;
}
