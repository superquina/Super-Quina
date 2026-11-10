"use client";
import { FormEvent, useState } from "react";

type UserRole = "PLAYER" | "CASHIER" | "ADMIN";
type SessionResponse = { authenticated: true; user: { role: UserRole; mustChangePassword: boolean } };
const destinationByRole = { PLAYER: "/player", CASHIER: "/cashier", ADMIN: "/admin" } as const;

export function LoginForm({ allowedRole }: { allowedRole?: UserRole } = {}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setError("");
    setIsSubmitting(true);
    try {
      const login = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      if (!login.ok) {
        setError(login.status === 401 ? "Usuário ou senha inválidos." : "Não foi possível entrar agora. Tente novamente.");
        return;
      }
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok) {
        setError("Não foi possível confirmar sua sessão. Tente novamente.");
        return;
      }
      const session = await response.json() as SessionResponse;
      if (allowedRole && session.user.role !== allowedRole) {
        await fetch("/api/auth/logout", { method: "POST" });
        setError("Este aplicativo é exclusivo para cambistas. Use uma conta de cambista para entrar.");
        return;
      }
      window.location.assign(session.user.mustChangePassword ? "/change-password" : destinationByRole[session.user.role]);
    } catch {
      setError("Falha de conexão. Verifique sua internet e tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <label htmlFor="username">Usuário</label>
      <input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={100} value={username} onChange={(event) => setUsername(event.target.value)} required />
      <label htmlFor="password">Senha</label>
      <input id="password" name="password" type="password" autoComplete="current-password" maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} required />
      <button className="primary-button" type="submit" disabled={isSubmitting}>{isSubmitting ? "Verificando..." : "Entrar"}</button>
      {error ? <p className="form-error form-feedback-error" role="alert" aria-live="assertive">{error}</p> : null}
    </form>
  );
}
