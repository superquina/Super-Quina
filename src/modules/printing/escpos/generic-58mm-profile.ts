import type { EscPosProfile } from "./encode-thermal-receipt";

/**
 * Conservative starting profile for generic 58 mm ESC/POS thermal printers
 * over Bluetooth Classic SPP. The user's self-test identifies the reference
 * unit as OY-580IP (Bluetooth name KPrinter_4765).
 *
 * Font A/B column counts remain initial presets until measured on the unit.
 * The printer self-test reports default code page 3 (PC860); we intentionally
 * leave ESC t unset so the printer retains its verified factory default.
 */
export const GENERIC_58MM_SPP_PROFILE_FONT_A: Readonly<EscPosProfile> = {
  paperWidthMm: 58,
  columns: 32,
  copies: 1,
  unsupportedCharacter: "transliterate",
  feedLines: 3,
  qrCode: true,
};

export const GENERIC_58MM_SPP_PROFILE_FONT_B: Readonly<EscPosProfile> = {
  paperWidthMm: 58,
  columns: 42,
  copies: 1,
  unsupportedCharacter: "transliterate",
  feedLines: 3,
};
