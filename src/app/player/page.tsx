import { AreaShell } from "@/components/area-shell";
import { NumericGamePurchaseForm } from "@/components/purchases/numeric-game-purchase-form";
import { PlayerRecentResults } from "@/components/player/player-recent-results";
import { PlayerBetHistory } from "@/components/player/player-bet-history";
import { PlayerWalletWithdrawals } from "@/components/player/player-wallet-withdrawals";
import { requireRole } from "@/lib/auth/require-role";

export const dynamic = "force-dynamic";

export default async function PlayerPage() {
  const user = await requireRole("PLAYER");
  return (
    <AreaShell title="Área do jogador" username={user.username} compact logoOnlyHeader logoutAtBottom>
      <NumericGamePurchaseForm mode="PLAYER" />
      <details className="player-collapsible-section">
        <summary>
          <span className="player-collapsible-label">Carteira digital</span>
          <span className="player-collapsible-title">Saldo e saques</span>
          <span className="player-collapsible-hint">Toque para consultar saldo ou solicitar saque</span>
        </summary>
        <PlayerWalletWithdrawals />
      </details>
      <details className="player-collapsible-section">
        <summary>
          <span className="player-collapsible-label">Suas apostas</span>
          <span className="player-collapsible-title">Histórico dos últimos 7 dias</span>
          <span className="player-collapsible-hint">Toque para ver seus números, rodadas e prêmios</span>
        </summary>
        <PlayerBetHistory />
      </details>
      <details className="player-collapsible-section">
        <summary>
          <span className="player-collapsible-label">Resultados</span>
          <span className="player-collapsible-title">Últimos resultados</span>
          <span className="player-collapsible-hint">Toque para consultar os sorteios publicados</span>
        </summary>
        <PlayerRecentResults />
      </details>
    </AreaShell>
  );
}
