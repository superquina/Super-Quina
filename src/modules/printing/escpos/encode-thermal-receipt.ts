import type { ThermalReceiptEntry } from "@/components/receipts/thermal-receipt-types";

export type ThermalReceiptForEncoding = {
  receiptCode: string;
  paymentStatus: "CONFIRMED";
  issuedAt: string;
  paymentMethod: string;
  totalCents: number;
  currency: string;
  customerLabel: string | null;
  cashierLabel: string | null;
  entries: ThermalReceiptEntry[];
};

export type EscPosProfile = {
  paperWidthMm: 58 | 80;
  /** Printable character columns measured/selected for this printer profile. */
  columns: number;
  /** ESC/POS built-in font selection; A is wider, B is narrower. */
  fontMode?: "A" | "B";
  /** Optional ESC t code-page selector. Omit unless verified for the printer. */
  codePageCommand?: number;
  /** Explicit Unicode-to-single-byte mapping verified for the selected printer. */
  characterMap?: Readonly<Record<string, number>>;
  /** Used when a character has no verified byte mapping. */
  unsupportedCharacter?: "replace" | "transliterate";
  /** This app intentionally supports exactly one customer copy per print job. */
  copies?: 1;
  feedLines?: number;
  /** Print the official receipt verification URL as an ESC/POS QR code. */
  qrCode?: boolean;
  cutMode?: "full" | "partial";
};

const ESC = 0x1b;
const GS = 0x1d;
const MAX_ENTRIES = 100;
const MAX_COLUMNS = 96;
const MAX_LABEL_LENGTH = 120;

function assertInteger(value: number, name: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Invalid ${name}`);
  }
}

function cleanLabel(value: string | null, name: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > MAX_LABEL_LENGTH) {
    throw new Error(`Invalid ${name}`);
  }
  return value.replace(/[\r\n\t]+/g, " ").trim() || null;
}

function transliterate(character: string): string {
  const replacements: Record<string, string> = {
    "á": "a", "à": "a", "â": "a", "ã": "a", "ä": "a",
    "Á": "A", "À": "A", "Â": "A", "Ã": "A", "Ä": "A",
    "é": "e", "è": "e", "ê": "e", "ë": "e",
    "É": "E", "È": "E", "Ê": "E", "Ë": "E",
    "í": "i", "ì": "i", "î": "i", "ï": "i",
    "Í": "I", "Ì": "I", "Î": "I", "Ï": "I",
    "ó": "o", "ò": "o", "ô": "o", "õ": "o", "ö": "o",
    "Ó": "O", "Ò": "O", "Ô": "O", "Õ": "O", "Ö": "O",
    "ú": "u", "ù": "u", "û": "u", "ü": "u",
    "Ú": "U", "Ù": "U", "Û": "U", "Ü": "U",
    "ç": "c", "Ç": "C", "ñ": "n", "Ñ": "N",
    "º": "o", "ª": "a", "–": "-", "—": "-", "·": "-",
    "“": '"', "”": '"', "’": "'", "‘": "'",
  };
  return replacements[character] ?? "?";
}

function encodeText(value: string, profile: EscPosProfile): number[] {
  const mode = profile.unsupportedCharacter ?? "transliterate";
  const bytes: number[] = [];
  for (const character of value) {
    const mapped = profile.characterMap?.[character];
    if (mapped !== undefined) {
      assertInteger(mapped, "character map byte", 0, 255);
      bytes.push(mapped);
      continue;
    }
    const code = character.codePointAt(0) ?? 0x3f;
    if (code >= 0x20 && code <= 0x7e) {
      bytes.push(code);
      continue;
    }
    if (mode === "transliterate") {
      const replacement = transliterate(character);
      for (const char of replacement) bytes.push(char.charCodeAt(0));
    } else {
      bytes.push(0x3f);
    }
  }
  return bytes;
}

function line(value: string, profile: EscPosProfile): number[] {
  return [...encodeText(value, profile), 0x0a];
}

function wrap(value: string, columns: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > columns) {
      if (current) lines.push(current);
      current = "";
      for (let offset = 0; offset < word.length; offset += columns) {
        const part = word.slice(offset, offset + columns);
        if (part.length === columns) lines.push(part);
        else current = part;
      }
      continue;
    }
    const candidate = current ? current + " " + word : word;
    if (candidate.length > columns) {
      lines.push(current);
      current = word;
    } else current = candidate;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function dateTime(value: string): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    timeZone: "America/Sao_Paulo",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}`;
}

/** ESC/POS QR sequence (GS ( k), model 2, medium error correction. */
function qrCode(value: string): number[] {
  const data = Array.from(new TextEncoder().encode(value));
  if (data.length < 1 || data.length > 700) throw new Error("Invalid QR code payload");
  const storeLength = data.length + 3;
  return [
    0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00,
    0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06,
    0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31,
    0x1d, 0x28, 0x6b, storeLength & 0xff, (storeLength >> 8) & 0xff, 0x31, 0x50, 0x30,
    ...data,
    0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30,
  ];
}

function money(cents: number): string {
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `R$ ${whole.toLocaleString("pt-BR")},${fraction}`;
}

function padPair(left: string, right: string, columns: number): string[] {
  const rightText = right.length > columns ? right.slice(-columns) : right;
  const leftWidth = Math.max(1, columns - rightText.length - 1);
  const leftLines = wrap(left, leftWidth);
  const output = leftLines.slice(0, -1);
  const finalLeft = leftLines[leftLines.length - 1] ?? "";
  output.push(finalLeft + " ".repeat(Math.max(1, columns - finalLeft.length - rightText.length)) + rightText);
  return output;
}

/** Pure ESC/POS encoder. It does not connect to a printer or decide payment state. */
export function encodeThermalReceipt(receipt: ThermalReceiptForEncoding, profile: EscPosProfile): Uint8Array {
  if (receipt.paymentStatus !== "CONFIRMED") throw new Error("Only confirmed receipts can be encoded");
  if (!/^SQ-[A-Z0-9]{8,32}$/.test(receipt.receiptCode)) throw new Error("Invalid receipt code");
  if (!Number.isSafeInteger(receipt.totalCents) || receipt.totalCents < 0) throw new Error("Invalid total");
  if (receipt.currency !== "BRL") throw new Error("Unsupported currency");
  if (!Number.isFinite(Date.parse(receipt.issuedAt))) throw new Error("Invalid issue date");
  if (!Array.isArray(receipt.entries) || receipt.entries.length < 1 || receipt.entries.length > MAX_ENTRIES) {
    throw new Error("Invalid receipt entries");
  }
  assertInteger(profile.columns, "columns", 16, MAX_COLUMNS);
  if (profile.codePageCommand !== undefined) assertInteger(profile.codePageCommand, "code page command", 0, 255);
  if (profile.copies !== undefined && profile.copies !== 1) throw new Error("Only one customer receipt copy is supported");
  const feedLines = profile.feedLines ?? 3;
  assertInteger(feedLines, "feed lines", 0, 10);

  const paymentMethod = cleanLabel(receipt.paymentMethod, "payment method");
  if (!paymentMethod) throw new Error("Invalid payment method");
  const customer = cleanLabel(receipt.customerLabel, "customer label");
  const cashier = cleanLabel(receipt.cashierLabel, "cashier label");
  const columns = profile.columns;
  const bytes: number[] = [ESC, 0x40];
  if (profile.fontMode !== undefined) bytes.push(ESC, 0x4d, profile.fontMode === "B" ? 0x01 : 0x00);
  if (profile.codePageCommand !== undefined) bytes.push(ESC, 0x74, profile.codePageCommand);
  bytes.push(ESC, 0x61, 0x01, ESC, 0x45, 0x01);
  bytes.push(...line("SUPER QUINA", profile));
  bytes.push(ESC, 0x45, 0x00);
  bytes.push(...line("COMPROVANTE DE APOSTA", profile));
  bytes.push(...line(dateTime(receipt.issuedAt), profile));
  bytes.push(ESC, 0x61, 0x00);
  bytes.push(...line("RECIBO: " + receipt.receiptCode, profile));
  for (const part of wrap("PAGAMENTO: " + paymentMethod, columns)) bytes.push(...line(part, profile));
  if (customer) for (const part of wrap("CLIENTE: " + customer, columns)) bytes.push(...line(part, profile));
  if (cashier) {
    bytes.push(ESC, 0x45, 0x01);
    for (const part of wrap("CAMBISTA: " + cashier, columns)) bytes.push(...line(part, profile));
    bytes.push(ESC, 0x45, 0x00);
  }
  bytes.push(...line("-".repeat(columns), profile));

  for (const entry of receipt.entries) {
    if (typeof entry.numberValue !== "string" || entry.numberValue.length < 1 || entry.numberValue.length > 40) {
      throw new Error("Invalid entry number");
    }
    if (typeof entry.roundCode !== "string" || entry.roundCode.length > 40 || /[\r\n]/.test(entry.roundCode)) throw new Error("Invalid round code");
    if (!Number.isFinite(Date.parse(entry.resultAt))) throw new Error("Invalid draw date");
    if (!Number.isSafeInteger(entry.stakeCents) || entry.stakeCents < 0) throw new Error("Invalid stake");
    for (const part of wrap(entry.numberValue, columns)) bytes.push(...line(part, profile));
    for (const part of wrap("Rodada " + entry.roundCode, columns)) bytes.push(...line(part, profile));
    for (const part of wrap("Sorteio " + dateTime(entry.resultAt), columns)) {
      bytes.push(...line(part, profile));
    }
    bytes.push(...line("Valor: " + money(entry.stakeCents), profile));
    if ([entry.unitCents, entry.tensCents, entry.hundredsCents, entry.thousandsCents, entry.quinaCents].some((value) => value !== undefined)) {
      bytes.push(...line("Unidade: " + money(entry.unitCents ?? 0) + " Dezena: " + money(entry.tensCents ?? 0), profile));
      bytes.push(...line("Centena: " + money(entry.hundredsCents ?? 0) + " Milhar: " + money(entry.thousandsCents ?? 0), profile));
      bytes.push(...line("Quina: " + money(entry.quinaCents ?? 0), profile));
    }
    bytes.push(...line("-".repeat(columns), profile));
  }

  bytes.push(ESC, 0x45, 0x01);
  for (const part of padPair("TOTAL PAGO", money(receipt.totalCents), columns)) bytes.push(...line(part, profile));
  bytes.push(ESC, 0x45, 0x00, ESC, 0x61, 0x01);
  bytes.push(...line("GUARDE ESTE COMPROVANTE", profile));
  bytes.push(...line(receipt.receiptCode, profile));
  if (profile.qrCode) {
    bytes.push(ESC, 0x61, 0x01);
    bytes.push(...qrCode("https://superquina.com/verificar-recibo/" + encodeURIComponent(receipt.receiptCode)));
    bytes.push(0x0a, ESC, 0x61, 0x00);
  }
  bytes.push(ESC, 0x61, 0x00);
  bytes.push(...Array.from({ length: feedLines }, () => 0x0a));
  if (profile.cutMode === "full") bytes.push(GS, 0x56, 0x00);
  if (profile.cutMode === "partial") bytes.push(GS, 0x56, 0x01);
  return new Uint8Array(bytes);
}
