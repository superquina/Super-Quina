import Link from "next/link";

type BrandLogoProps = {
  className?: string;
  imageClassName?: string;
  imageStyle?: React.CSSProperties;
  label?: string;
};

/** Ícone da Super Quina para pontos da interface que exigem uma marca compacta. */
export function BrandLogo({
  className = "",
  imageClassName = "",
  imageStyle,
  label = "Super Quina — página inicial",
}: BrandLogoProps) {
  return (
    <Link href="/" className={className} aria-label={label}>
      <img
        src="/images/brand/super-quina-icon.PNG"
        alt="Super Quina"
        className={imageClassName}
        style={{ display: "block", objectFit: "contain", ...imageStyle }}
      />
    </Link>
  );
}
