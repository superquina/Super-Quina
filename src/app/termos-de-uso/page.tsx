import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

export const metadata = {
  title: "Termos de uso em preparação | Super Quina",
  description: "Os termos completos serão publicados após a conclusão e validação das regras e do funcionamento da plataforma.",
};

export default function TermsPage() {
  return <main className="page-shell site-page-shell"><SiteHeader /><article className="feature-card terms-page">
    <span className="feature-label">Em preparação</span>
    <h1>Termos de uso</h1>
    <p>Os termos de uso definitivos ainda estão em elaboração. Eles serão preparados após a conclusão e revisão do funcionamento da plataforma, incluindo modalidades de jogo, regras de participação, pagamentos, apuração dos resultados, créditos e resgate de prêmios, comprovantes, prazos, atendimento e demais condições aplicáveis.</p>
    <p>Esta página não define nem publica regras definitivas sobre validade de compras, prêmios ou prazos para reclamação.</p>
    <p><Link href="/login">Voltar para entrar</Link></p>
  </article></main>;
}
