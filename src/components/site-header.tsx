import Image from "next/image";
import Link from "next/link";

/** Cabeçalho único da Super Quina: cenário e logomarca levam à página inicial. */
export function SiteHeader() {
  return (
    <header className="site-header site-header-scenery" aria-label="Cabeçalho Super Quina">
      <Link
        className="site-header-home-link"
        href="/"
        aria-label="Ir para a página inicial da Super Quina"
      >
        <Image
          className="site-header-scenery-image"
          src="/images/brand/super-quina-header.webp"
          alt="Super Quina"
          width={1536}
          height={512}
          priority
          sizes="100vw"
        />
      </Link>
    </header>
  );
}
