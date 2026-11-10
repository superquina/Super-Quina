"use client";
import { FormEvent, useState } from "react";

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (newPassword !== confirmPassword) {
      setError("A confirmação da nova senha não corresponde.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? "Não foi possível alterar a senha.");
        return;
      }
      window.location.assign("/login");
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="login-form" onSubmit={submit}>
    <label htmlFor="current-password">Senha atual</label>
    <input id="current-password" type="password" autoComplete="current-password" maxLength={1024} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required />
    <label htmlFor="new-password">Nova senha (mínimo de 6 caracteres)</label>
    <input id="new-password" type="password" autoComplete="new-password" minLength={6} maxLength={1024} value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
    <label htmlFor="confirm-password">Confirme a nova senha</label>
    <input id="confirm-password" type="password" autoComplete="new-password" minLength={6} maxLength={1024} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
    <button className="primary-button" type="submit" disabled={busy}>{busy ? "Atualizando..." : "Alterar senha"}</button>
    {error ? <p className="form-error form-feedback-error" role="alert" aria-live="assertive">{error}</p> : null}
  </form>;
}
