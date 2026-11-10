import { readNumericPrizeMultipliers, type NumericPrizeCategory } from "./numeric-prize-rules";
import { normalizeNumber } from "../modules/numbers/normalize-number";

export const NUMERIC_PRIZE_CATEGORY_LABELS: Record<NumericPrizeCategory, string> = {
  unit: "Unidade",
  tens: "Dezena",
  hundreds: "Centena",
  thousands: "Milhar",
  quina: "Quina",
};

const FIELDS: Record<NumericPrizeCategory, "unitCents" | "tensCents" | "hundredsCents" | "thousandsCents" | "quinaCents"> = {
  unit: "unitCents",
  tens: "tensCents",
  hundreds: "hundredsCents",
  thousands: "thousandsCents",
  quina: "quinaCents",
};

type NumericLineForPrizeReview = {
  numberValue: string;
  unitCents: number;
  tensCents: number;
  hundredsCents: number;
  thousandsCents: number;
  quinaCents: number;
  ruleVersion: string;
  ruleSnapshot: unknown;
};

export function getNumericPrizeReview(line: NumericLineForPrizeReview, resultNumber: string | null) {
  if (!resultNumber) return null;
  const bet = normalizeNumber(line.numberValue);
  const result = normalizeNumber(resultNumber);
  const category: NumericPrizeCategory | null =
    bet === result ? "quina" :
    bet.slice(-4) === result.slice(-4) ? "thousands" :
    bet.slice(-3) === result.slice(-3) ? "hundreds" :
    bet.slice(-2) === result.slice(-2) ? "tens" :
    bet.slice(-1) === result.slice(-1) ? "unit" : null;
  if (!category) return null;

  const multipliers = readNumericPrizeMultipliers(line.ruleVersion, line.ruleSnapshot);
  if (!multipliers) return { category, stakeCents: line[FIELDS[category]], multiplier: null, calculatedPrizeCents: null, calculationConsistent: false };
  const stakeCents = line[FIELDS[category]];
  const multiplier = multipliers[category];
  const calculatedPrizeCents = stakeCents * multiplier;
  return {
    category,
    stakeCents,
    multiplier,
    calculatedPrizeCents,
    calculationConsistent: Number.isSafeInteger(stakeCents) && stakeCents >= 0 &&
      Number.isSafeInteger(calculatedPrizeCents) && calculatedPrizeCents <= 2_147_483_647,
  };
}
