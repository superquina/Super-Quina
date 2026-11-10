import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PreventPullToRefresh } from "@/components/prevent-pull-to-refresh";

const siteUrl = "https://superquina.com";

const icon = "/images/brand/super-quina-icon.webp";
const favicon = "/_next/image?url=%2Fimages%2Fbrand%2Fsuper-quina-icon.webp&w=64&q=75";
const appleIcon = "/_next/image?url=%2Fimages%2Fbrand%2Fsuper-quina-icon.webp&w=180&q=75";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  title: {
    default: "Super Quina | Página Inicial Oficial",
    template: "%s | Super Quina",
  },
  description: "Página inicial oficial da Super Quina. Conheça como funciona o jogo, veja as informações e acesse sua conta quando desejar.",
  applicationName: "Super Quina",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Super Quina",
  },
  icons: {
    icon: [{ url: favicon, sizes: "64x64" }],
    apple: [{ url: appleIcon, sizes: "180x180" }],
    shortcut: [{ url: favicon, sizes: "64x64" }],
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Super Quina",
    title: "Super Quina | Jogo Numérico",
    description: "Seja um ponto credenciado Super Quina. Solicite seu kit gratuito.",
    url: siteUrl,
    images: [{ url: icon, alt: "Super Quina" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Super Quina",
    description: "Jogue cinco números e concorra a cinco categorias de prêmios.",
    images: [icon],
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#001584",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body><PreventPullToRefresh />{children}</body>
    </html>
  );
}
