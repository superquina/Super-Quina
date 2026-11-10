"use client";

import { useEffect, useState } from "react";

type VerifiedNumber = { numberValue: string; resultStatus: "AGUARDANDO" | "PREMIADA" | "NAO_PREMIADA" | "AGUARDANDO_APURACAO"; prizeCents: number | null; prizePaid: boolean; payoutChannel?: "PLATFORM_PIX" | "CASHIER_CASH" | null };

type VerifiedRound = {
  resultNumber: string | null;
  numbers: VerifiedNumber[];
  roundCode: string;
  status: "RODADA_CANCELADA" | "RESULTADO_PUBLICADO" | "SORTEIO_AGUARDANDO" | "AGUARDANDO_RESULTADO_OFICIAL";
  startsAt: string;
  resultAt: string;
};

type VerifiedReceipt = {
  valid: boolean;
  receiptCode?: string;
  status?: string;
  paymentMethod?: string;
  totalCents?: number;
  currency?: string;
  confirmedAt?: string | null;
  manualPayoutEligible?: boolean;
  rounds?: VerifiedRound[];
  message: string;
};

const prizeSupportWhatsapp = (process.env.NEXT_PUBLIC_PRIZE_SUPPORT_WHATSAPP || "5577991601217").replace(/\D/g, "");
const prizeSupportUrl = `https://wa.me/${prizeSupportWhatsapp}`;

const roundStatusLabels: Record<VerifiedRound["status"], string> = {
  SORTEIO_AGUARDANDO: "Aguardando sorteio",
  AGUARDANDO_RESULTADO_OFICIAL: "Aguardando resultado",
  RESULTADO_PUBLICADO: "Publicado",
  RODADA_CANCELADA: "Cancelada",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

export function ReceiptVerification({ receiptCode }: { receiptCode: string }) {
  const [data, setData] = useState<VerifiedReceipt | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let requestController: AbortController | null = null;

    async function verify() {
      requestController?.abort();
      const controller = new AbortController();
      requestController = controller;
      try {
        const response = await fetch(
          `/api/public/receipt-verification/${encodeURIComponent(receiptCode)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const body = await response.json() as VerifiedReceipt;
        if (active && !controller.signal.aborted) setData(body);
      } catch {
        if (active && !controller.signal.aborted) {
          setData({ valid: false, message: "Não foi possível consultar. Tente novamente." });
        }
      } finally {
        if (active && !controller.signal.aborted) setLoading(false);
      }
    }

    void verify();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void verify();
    }, 30_000);
    const refreshOnFocus = () => {
      if (document.visibilityState === "visible") void verify();
    };
    document.addEventListener("visibilitychange", refreshOnFocus);
    window.addEventListener("focus", refreshOnFocus);

    return () => {
      active = false;
      requestController?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshOnFocus);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [receiptCode]);

  if (loading) return <p role="status" style={{ color: "#111827", fontWeight: 700 }}>Consultando recibo…</p>;
  if (!data) return <p role="alert" style={{ color: "#b91c1c", fontWeight: 700 }}>Não foi possível consultar o recibo.</p>;

  const rounds = data.valid ? data.rounds ?? [] : [];
  const hasAvailablePrize = Boolean(data.manualPayoutEligible) && rounds.some((round) => round.numbers.some((number) => number.resultStatus === "PREMIADA" && !number.prizePaid));
  const prizeContactUrl = `${prizeSupportUrl}?text=${encodeURIComponent(`Olá! Consultei o recibo ${data.receiptCode ?? receiptCode.toUpperCase()} e tenho um prêmio disponível. Gostaria de orientação para receber.`)}`;

  return (
    <section aria-live="polite" style={{ border: "2px solid #9ca3af", borderRadius: 10, padding: 16, background: "#ffffff", color: "#111827", fontSize: 16, lineHeight: 1.5 }}>
      <div style={{ padding: "13px 10px", borderRadius: 7, background: "#92400e", color: "#ffffff", textAlign: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 21, fontWeight: 800, letterSpacing: "0.02em" }}>RESULTADOS</h2>
      </div>
      {!data.valid && <p role="alert" style={{ color: "#991b1b", fontWeight: 700 }}>{data.message}</p>}
      <p style={{ margin: "0 0 8px", fontSize: 16, color: "#111827" }}><strong>Recibo:</strong> {data.receiptCode ?? receiptCode.toUpperCase()}</p>

      {data.valid && (
        <>
          <h3 style={{ margin: "0 0 10px", fontSize: 19, color: "#111827", fontWeight: 800 }}>Resultados</h3>
          {rounds.length ? rounds.map((round) => (
            <article key={round.roundCode} style={{ border: "1px solid #9ca3af", borderRadius: 8, padding: 13, marginTop: 10, background: "#ffffff", color: "#111827" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                <strong style={{ fontSize: 17, color: "#111827" }}>{round.roundCode}</strong>
                <span style={{
                  display: "inline-block",
                  borderRadius: 5,
                  padding: "3px 8px",
                  fontSize: 14,
                  fontWeight: 800,
                  color: round.status === "RESULTADO_PUBLICADO" ? "#166534" : round.status === "RODADA_CANCELADA" ? "#991b1b" : "#854d0e",
                  background: round.status === "RESULTADO_PUBLICADO" ? "#dcfce7" : round.status === "RODADA_CANCELADA" ? "#fee2e2" : "#fef3c7",
                }}>{roundStatusLabels[round.status]}</span>
              </div>
              <p style={{ margin: "0 0 10px", color: "#374151", fontSize: 14 }}><strong>Horário:</strong> {formatDate(round.resultAt)}</p>
              {round.status === "RESULTADO_PUBLICADO" && (
                <div>
                  <strong style={{ display: "block", fontSize: 13, color: "#374151", marginBottom: 4 }}>Número sorteado</strong>
                  <div style={{ padding: "12px 8px", border: "2px solid #6b7280", borderRadius: 6, textAlign: "center", fontSize: 28, letterSpacing: "0.16em", color: "#111827", fontWeight: 900, background: "#f9fafb" }}>{round.resultNumber ?? "—"}</div>
                </div>
              )}
              {round.numbers.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <strong style={{ display: "block", color: "#111827", marginBottom: 6 }}>Seus números</strong>
                  <div style={{ display: "grid", gap: 6 }}>
                    {round.numbers.map((number, index) => {
                      const status = number.resultStatus === "PREMIADA" ? (number.prizePaid ? number.payoutChannel === "CASHIER_CASH" ? "PRÊMIO PAGO — dinheiro pelo cambista" : number.payoutChannel === "PLATFORM_PIX" ? "PRÊMIO PAGO — Pix pela plataforma" : "Prêmio creditado na carteira" : "PRÊMIO DISPONÍVEL")
                        : number.resultStatus === "NAO_PREMIADA" ? "Não premiada"
                          : number.resultStatus === "AGUARDANDO_APURACAO" ? "Aguardando apuração"
                            : round.status === "RODADA_CANCELADA" ? "Rodada cancelada" : round.status === "SORTEIO_AGUARDANDO" ? "Aguardando sorteio" : "Aguardando resultado";
                      const color = number.resultStatus === "PREMIADA" ? "#166534" : number.resultStatus === "NAO_PREMIADA" ? "#991b1b" : "#1d4ed8";
                      return <div key={round.roundCode + number.numberValue + index} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, padding: "8px 10px", borderRadius: 6, background: "#f3f4f6", border: "1px solid #d1d5db" }}>
                        <strong style={{ color: "#111827", fontSize: 18, letterSpacing: "0.1em" }}>{number.numberValue}</strong>
                        <span style={{ color, fontWeight: 800, fontSize: 14 }}>{status}</span>
                      </div>;
                    })}
                  </div>
                </div>
              )}
            </article>
          )) : <p style={{ color: "#374151" }}>Nenhuma rodada confirmada para este recibo.</p>}
        </>
      )}
      {hasAvailablePrize && <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid #d1d5db", textAlign: "center" }}>
        <p style={{ margin: "0 0 9px", color: "#374151", fontSize: 14 }}>Você tem um prêmio disponível. Entre em contato para combinar o recebimento.</p>
        <a href={prizeContactUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", padding: "10px 16px", borderRadius: 7, background: "#15803d", color: "#ffffff", fontWeight: 800, textDecoration: "none" }}>Receber prêmio pelo WhatsApp</a>
      </div>}
      <p style={{ margin: "14px 0 0", color: "#6b7280", fontSize: 12, textAlign: "center" }}>Super Quina · superquina.com</p>
    </section>
  );
}
