"use client";

import { useEffect, useState, type CSSProperties } from "react";

import type { ThermalReceiptEntry } from "./thermal-receipt-types";
import { getReceiptRepetitionNumbers } from "./receipt-repetition";
import { createReceiptQrDataUrl } from "./receipt-qr";
export { getReceiptRepetitionNumbers } from "./receipt-repetition";

export type ThermalReceiptProps = {
  receiptCode: string;
  paymentStatus: "CONFIRMED" | "PENDING_PAYMENT" | "CANCELLED" | "REFUNDED";
  issuedAt: string;
  totalCents: number;
  entries: ThermalReceiptEntry[];
  customerLabel?: string | null;
  cashierLabel?: string | null;
  paymentLabel?: string;
  qrCodeDataUrl?: string | null;
  onClose?: () => void;
};

/**
 * Print-ready 58 mm thermal receipt.
 * Only accepts a confirmed payment so pending purchases cannot be presented
 * as an official receipt. The verification QR code is generated locally.
 */
export function ThermalReceipt({
  receiptCode,
  paymentStatus,
  issuedAt,
  totalCents,
  entries,
  customerLabel,
  cashierLabel,
  paymentLabel = "Pagamento confirmado",
  qrCodeDataUrl,
  onClose,
}: ThermalReceiptProps) {
  const [generatedQr, setGeneratedQr] = useState<{ receiptCode: string; url: string } | null>(null);
  useEffect(() => {
    if (paymentStatus !== "CONFIRMED" || !/^SQ-[A-Z0-9]{8,32}$/.test(receiptCode)) {
      return;
    }

    const verificationUrl = window.location.origin + "/verificar-recibo/" + encodeURIComponent(receiptCode);
    let url = "";
    try {
      url = createReceiptQrDataUrl(verificationUrl);
    } catch {
      // Keep the receipt available even if local QR generation fails.
    }

    queueMicrotask(() => setGeneratedQr({ receiptCode, url }));
  }, [receiptCode, paymentStatus]);

  if (paymentStatus !== "CONFIRMED" || !/^SQ-[A-Z0-9]{8,32}$/.test(receiptCode)) return null;

  const money = (cents: number) => new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
  const issuedDate = new Date(issuedAt);
  const dateLabel = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(issuedDate);
  const timeLabel = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Sao_Paulo",
  }).format(issuedDate);
  const date = `${dateLabel} ${timeLabel}`;
  const drawDateTime = (value: string) => {
    const drawDate = new Date(value);
    if (Number.isNaN(drawDate.getTime())) return "Horário do sorteio indisponível";
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      timeZone: "America/Sao_Paulo",
    }).format(drawDate);
  };

  const qrStyle: CSSProperties = { width: 76, height: 76, objectFit: "contain" };
  const effectiveQrUrl = qrCodeDataUrl ?? (generatedQr?.receiptCode === receiptCode && generatedQr.url ? generatedQr.url : null);
  const repetitionNumbers = getReceiptRepetitionNumbers(entries);

  return (
    <div className="thermal-receipt-print-root">
      <article id={`thermal-receipt-${receiptCode}`} className="thermal-receipt" aria-label={`Recibo ${receiptCode}`}>
        <header className="thermal-receipt-header">
          <strong className="thermal-receipt-brand">SUPER QUINA</strong>
          <span>COMPROVANTE DE APOSTA</span>
          <span>{date}</span>
          <span className="thermal-receipt-payment">{paymentLabel}</span>
        </header>

        <section className="thermal-receipt-code-row" aria-label="Código e QR Code do recibo">
          <div className="thermal-receipt-code-copy">
            <span className="thermal-receipt-label">CÓDIGO DO RECIBO</span>
            <strong className="thermal-receipt-code">{receiptCode}</strong>
          </div>
          {effectiveQrUrl ? (
            <img className="thermal-receipt-qr" style={qrStyle} src={effectiveQrUrl} alt={`QR Code do recibo ${receiptCode}`} />
          ) : (
            <div className="thermal-receipt-qr-placeholder" aria-label="QR Code indisponível">
              QR indisponível
            </div>
          )}
        </section>

        {customerLabel && <p className="thermal-receipt-customer"><span>Cliente:</span> {customerLabel}</p>}
        {cashierLabel && <p className="thermal-receipt-customer thermal-receipt-cashier"><strong>CAMBISTA: {cashierLabel}</strong></p>}

        <div className="thermal-receipt-divider" />
        <section className="thermal-receipt-items">
          <strong className="thermal-receipt-section-title">APOSTAS</strong>
          {entries.map((entry, index) => (
            <div className="thermal-receipt-item" key={`${entry.roundCode}-${entry.numberValue}-${index}`}>
              <div className="thermal-receipt-item-heading">
                <strong>{entry.numberValue}</strong>
                <strong>{money(entry.stakeCents)}</strong>
              </div>
              <span>Repetição {repetitionNumbers[index]} · Jogo Super Quina</span>
              <span>Unidade: {money(entry.unitCents ?? 0)} · Dezena: {money(entry.tensCents ?? 0)}</span>
              <span>Centena: {money(entry.hundredsCents ?? 0)} · Milhar: {money(entry.thousandsCents ?? 0)}</span>
              <span>Quina: {money(entry.quinaCents ?? 0)}</span>
              <strong className="thermal-receipt-draw-time">Sorteio: {drawDateTime(entry.resultAt)}</strong>
              <span>Rodada {entry.roundCode}</span>
            </div>
          ))}
        </section>

        <div className="thermal-receipt-divider" />
        <div className="thermal-receipt-total">
          <span>TOTAL PAGO</span>
          <strong>{money(totalCents)}</strong>
        </div>
        <footer className="thermal-receipt-footer">
          <strong>GUARDE ESTE COMPROVANTE</strong>
          <span>Consulte o resultado pelo código do recibo.</span>
          <span>Este recibo é um comprovante de pagamento e contém suas apostas.</span>
          <span className="thermal-receipt-footer-code">{receiptCode}</span>
        </footer>
      </article>
      {onClose && (
        <div className="thermal-receipt-actions" aria-label="Ações do recibo">
          <button className="thermal-receipt-exit-button" type="button" onClick={onClose}>Fechar recibo</button>
        </div>
      )}
    </div>
  );
}
