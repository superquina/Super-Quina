import type { Metadata } from "next";
import Image from "next/image";
import { HomeAccess, HomeAccessFooter } from "@/components/home-access";

export const metadata: Metadata = {
  title: "Super Quina | Página Inicial Oficial",
  description: "Página inicial oficial da Super Quina. Conheça como funciona o jogo, veja as informações e acesse sua conta quando desejar.",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
};

export default function HomePage() {
  return (
    <div className="home-page home-page-compact">
      <HomeAccess />
      <main className="home-entry">
        <figure className="home-how-infographic numeric-game-infographic">
          <Image
            src="/images/brand/super-quina-inicio.webp"
            alt="Como funciona o jogo Super Quina"
            className="home-how-infographic-image"
            width={1200}
            height={1200}
            priority
            sizes="(max-width: 768px) 100vw, 1100px"
          />
          <a
            className="home-kit-whatsapp-link"
            href="https://wa.me/5577991601217?text=Quero%20ser%20um%20cambista%20credenciado%20da%20Super%20Quina."
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Solicitar o kit gratuito da Super Quina pelo WhatsApp"
          />
        </figure>

        <HomeAccessFooter />
      </main>
    </div>
  );
}
