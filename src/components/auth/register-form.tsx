"use client";

import { FormEvent, useState } from "react";

export function RegisterForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setError("");
    if (password !== confirmPassword) {
      setError("As senhas não conferem.");
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        setError(body?.error ?? "Não foi possível criar sua conta agora. Tente novamente.");
        return;
      }
      window.location.assign("/player");
    } catch {
      setError("Falha de conexão. Verifique sua internet e tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <label htmlFor="username">Escolha seu usuário</label>
      <input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={24} pattern="[A-Za-z0-9_.-]+" value={username} onChange={(event) => setUsername(event.target.value)} required aria-describedby="username-help" />
      <p id="username-help" className="password-requirement">Use de 3 a 24 caracteres: letras, números, ponto, hífen ou sublinhado.</p>
      <label htmlFor="password">Crie uma senha</label>
      <input id="password" name="password" type="password" autoComplete="new-password" minLength={6} maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} required aria-describedby="password-help" />
      <p id="password-help" className="password-requirement">A senha deve ter pelo menos 6 caracteres.</p>
      <label htmlFor="confirm-password">Confirme sua senha</label>
      <input id="confirm-password" name="confirm-password" type="password" autoComplete="new-password" minLength={6} maxLength={1024} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
      <button className="primary-button" type="submit" disabled={isSubmitting}>{isSubmitting ? "Criando conta..." : "Criar minha conta"}</button>
      {error ? <p className="form-error form-feedback-error" role="alert" aria-live="assertive">{error}</p> : null}
    </form>
  );
}
