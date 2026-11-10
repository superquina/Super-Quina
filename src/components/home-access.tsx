"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

export function HomeAccess() {
  return (
    <div className="home-header-wrap">
      <SiteHeader />
    </div>
  );
}

export function HomeAccessFooter() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  return (
    <>
      <div className="home-access-footer">
        <button className="home-footer-access" type="button" onClick={() => setIsOpen(true)} aria-haspopup="dialog" aria-expanded={isOpen}>
          Entrar
        </button>
      </div>
      {isOpen ? (
        <div className="home-access-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setIsOpen(false);
        }}>
          <section className="home-access-dialog" role="dialog" aria-modal="true" aria-labelledby="home-access-title">
            <button className="home-access-close" type="button" onClick={() => setIsOpen(false)} aria-label="Fechar">×</button>
            <h2 id="home-access-title">Acesse a Super Quina</h2>
            <p>Entre na sua conta ou crie seu cadastro.</p>
            <div className="home-access-options">
              <Link href="/login" className="home-access-login">Entrar</Link>
              <Link href="/cadastro" className="home-access-register">Criar conta</Link>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
