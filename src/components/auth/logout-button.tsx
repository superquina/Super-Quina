"use client";
import { useState } from "react";

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  async function logout() {
    if (busy) return;
    setBusy(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); }
    finally { window.location.assign("/login"); }
  }
  return <button className="logout-button" type="button" onClick={logout} disabled={busy}>{busy ? "Saindo..." : "Sair"}</button>;
}