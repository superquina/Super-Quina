import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { SiteHeader } from "@/components/site-header";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Alterar senha | Joga Placas" };

export default async function ChangePasswordPage() {
  const cookieStore = await cookies();
  const user = await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");
  if (!user.mustChangePassword) {
    const destination = user.role === "ADMIN" ? "/admin" : user.role === "CASHIER" ? "/cashier" : "/player";
    redirect(destination);
  }
  return <main className="auth-layout"><SiteHeader /><section className="auth-card" aria-labelledby="change-password-title">
    <p className="eyebrow">Segurança da conta</p><h1 id="change-password-title">Atualize sua senha</h1>
    <p className="auth-description">Sua conta exige uma nova senha antes de continuar. Use pelo menos 6 caracteres.</p>
    <ChangePasswordForm />
  </section></main>;
}
