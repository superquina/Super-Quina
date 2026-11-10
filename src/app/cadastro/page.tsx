import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "@/components/auth/register-form";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Criar conta | Super Quina",
  description: "Crie sua conta de jogador na Super Quina.",
};

export default function RegisterPage() {
  return (
    <main className="auth-layout">
      <SiteHeader />
      <section className="auth-card" aria-labelledby="register-title">
        <p className="eyebrow">Cadastro de jogador</p>
        <h1 id="register-title">Crie sua conta</h1>
        <p className="auth-description">Escolha seu usuário e uma senha segura para acessar sua área de jogador.</p>
        <RegisterForm />
        <p className="security-note">O cadastro público cria somente contas de jogador. Contas de cambista e administrador são provisionadas separadamente.</p>
        <p className="security-note">Já tem uma conta? <Link href="/login">Entrar</Link></p>
        <p className="security-note"><Link href="/">Voltar à página inicial</Link></p>
      </section>
    </main>
  );
}
