import type { MetadataRoute } from "next";

const siteUrl = "https://superquina.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/login", "/cadastro", "/consulta", "/verificar-recibo/"],
      disallow: [
        "/admin",
        "/administrador",
        "/dashboard",
        "/cashier",
        "/cambista",
        "/player",
        "/jogador",
        "/api",
      ],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
