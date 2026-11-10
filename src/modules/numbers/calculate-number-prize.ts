import {
  readNumericPrizeMultipliers,
  type NumericPrizeCategory,
} from "../../domain/numeric-prize-rules";
import { normalizeNumber } from "./normalize-number";

export type NumericSettlementLine = {
  numberValue: string;
  unitCents: number;
  tensCents: number;
  hundredsCents: number;
  thousandsCents: number;
  quinaCents: number;
  ruleVersion: string;
  ruleSnapshot: unknown;
};

const ALLOCATION_FIELD: Record<NumericPrizeCategory,
  "unitCents" | "tensCents" | "hundredsCents" | "thousandsCents" | "quinaCents"> = {
  unit: "unitCents",
  tens: "tensCents",
  hundreds: "hundredsCents",
  thousands: "thousandsCents",
  quina: "quinaCents",
};

/**
 * Award exactly one prize per line: the highest matching category.
 * A quina also matches quadra/terno/dezena/unidade suffixes, but only quina is paid.
 */
export function calculateNumberPrizeCents(line: NumericSettlementLine, drawnNumber: string): number {
  const bet = normalizeNumber(line.numberValue);
  const drawn = normalizeNumber(drawnNumber);
  const multipliers = readNumericPrizeMultipliers(line.ruleVersion, line.ruleSnapshot);
  if (!multipliers) throw new Error("Stored numeric prize rule snapshot is invalid.");

  const matches: Array<{ category: NumericPrizeCategory; matched: boolean }> = [
    { category: "quina", matched: bet === drawn },
    { category: "thousands", matched: bet.slice(-4) === drawn.slice(-4) },
    { category: "hundreds", matched: bet.slice(-3) === drawn.slice(-3) },
    { category: "tens", matched: bet.slice(-2) === drawn.slice(-2) },
    { category: "unit", matched: bet.slice(-1) === drawn.slice(-1) },
  ];

  // Most specific match wins; lower categories are not accumulated.
  const winningCategory = matches.find(({ matched }) => matched)?.category;
  if (!winningCategory) return 0;

  const stake = line[ALLOCATION_FIELD[winningCategory]];
  if (!Number.isSafeInteger(stake) || stake < 0) {
    throw new Error("Stored numeric category allocation is invalid.");
  }
  const prize = stake * multipliers[winningCategory];
  if (!Number.isSafeInteger(prize) || prize > 2_147_483_647) {
    throw new Error("Numeric prize exceeds the database integer range.");
  }
  return prize;
}
