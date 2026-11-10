import type { ThermalReceiptEntry } from "./thermal-receipt-types";

/**
 * Assigns a stable sequence number to each distinct round in the supplied
 * participation order. Multiple number entries in the same round share a repetition number.
 */
export function getReceiptRepetitionNumbers(entries: ThermalReceiptEntry[]): number[] {
  const numbersByRound = new Map<string, number>();
  return entries.map((entry) => {
    const existing = numbersByRound.get(entry.roundCode);
    if (existing !== undefined) return existing;
    const next = numbersByRound.size + 1;
    numbersByRound.set(entry.roundCode, next);
    return next;
  });
}
