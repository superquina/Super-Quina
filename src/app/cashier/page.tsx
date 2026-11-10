import { AreaShell } from "@/components/area-shell";
import { requireRole } from "@/lib/auth/require-role";
import { CashierSaleForm } from "@/components/cashier/cashier-sale-form";
import { PlayerRecentResults } from "@/components/player/player-recent-results";
import { CashierSalesSummary } from "@/components/cashier/cashier-sales-summary";
import { CashierPrizePayout } from "@/components/cashier/cashier-prize-payout";

export const dynamic = "force-dynamic";

export default async function CashierPage() {
  const user = await requireRole("CASHIER");
  return (
    <AreaShell title="Área do cambista" username={user.username} compact>
      <CashierSaleForm />
      <section className="cashier-info-card" aria-label="Informações do cambista">
        <CashierPrizePayout />
        <details className="player-collapsible-section cashier-info-results">
          <summary>
            <span className="player-collapsible-label">Resultados</span>
            <span className="player-collapsible-title">Últimos resultados</span>
          </summary>
          <PlayerRecentResults />
        </details>
        <CashierSalesSummary />
      </section>
    </AreaShell>
  );
}
