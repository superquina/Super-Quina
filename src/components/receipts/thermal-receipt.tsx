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

  function downloadReceipt() {
    const article = document.getElementById("thermal-receipt-" + receiptCode);
    if (!article) return;
    const styles = " @page{size:58mm auto;margin:2mm}*{box-sizing:border-box}body{margin:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif}.thermal-receipt{width:48mm;max-width:100%;margin:0 auto;padding:2mm 0;font-size:12px;line-height:1.35;overflow-wrap:anywhere;color:#000}.thermal-receipt *{color:#000!important;opacity:1!important;text-shadow:none!important;filter:none!important}.thermal-receipt-cashier{font-size:13px;font-weight:800;line-height:1.3}.thermal-receipt-header{display:flex;flex-direction:column;align-items:center;gap:2px;text-align:center}.thermal-receipt-brand{font-size:18px;letter-spacing:.04em}.thermal-receipt-code-row{display:grid;grid-template-columns:minmax(0,1fr) 20mm;align-items:center;gap:1.5mm;margin:3mm 0}.thermal-receipt-code-copy{display:flex;min-width:0;flex-direction:column;gap:2px}.thermal-receipt-label,.thermal-receipt-section-title{font-size:10px;font-weight:700}.thermal-receipt-code{font-size:13px;line-height:1.2;word-break:break-all}.thermal-receipt-payment{font-size:10px}.thermal-receipt-qr,.thermal-receipt-qr-placeholder{width:20mm;height:20mm;object-fit:contain}.thermal-receipt-qr-placeholder{display:grid;place-items:center;border:1px dashed #777}.thermal-receipt-divider{border-top:1px dashed #222;margin:2.5mm 0}.thermal-receipt-items{display:flex;flex-direction:column;gap:2.5mm}.thermal-receipt-item{display:flex;flex-direction:column;gap:1px}.thermal-receipt-item-heading,.thermal-receipt-total{display:flex;justify-content:space-between;gap:2mm}.thermal-receipt-total{font-size:14px}.thermal-receipt-footer{display:flex;flex-direction:column;align-items:center;gap:2px;margin-top:4mm;text-align:center;font-size:10px}.thermal-receipt-footer-code{margin-top:1mm;font-weight:700}.thermal-receipt-customer{margin:2mm 0}.thermal-receipt-cashier{color:#000;font-size:13px;font-weight:800;line-height:1.3;opacity:1}";
    const html = "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Recibo " + receiptCode + "</title><style>" + styles + "</style></head><body>" + article.outerHTML + "</body></html>";
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "recibo-" + receiptCode + ".html";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    onClose?.();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

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
      <div className="thermal-receipt-actions" aria-label="Ações do recibo">
        <button className="thermal-receipt-print-button" type="button" onClick={() => window.print()}>Imprimir recibo</button>
        <button className="thermal-receipt-download-button" type="button" onClick={downloadReceipt}>Baixar recibo</button>
        {onClose && <button className="thermal-receipt-exit-button" type="button" onClick={onClose}>Sair / Fechar recibo</button>}
      </div>
    </div>
  );
}
