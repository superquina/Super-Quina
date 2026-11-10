export const NUMERIC_PRIZE_CATEGORIES = [
  "unit",
  "tens",
  "hundreds",
  "thousands",
  "quina",
] as const;

export type NumericPrizeCategory = (typeof NUMERIC_PRIZE_CATEGORIES)[number];
export type NumericPrizeMultipliers = Record<NumericPrizeCategory, number>;

export const NUMERIC_PRIZE_RULE_VERSION = "numeric-admin-v1";

export const DEFAULT_NUMERIC_PRIZE_MULTIPLIERS: NumericPrizeMultipliers = {
  unit: 3,
  tens: 30,
  hundreds: 300,
  thousands: 3_000,
  quina: 30_000,
};

export const APPROVED_NUMERIC_PRIZE_MULTIPLIERS = DEFAULT_NUMERIC_PRIZE_MULTIPLIERS;

export function parseNumericPrizeMultipliers(value: unknown): NumericPrizeMultipliers | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const parsed = {} as NumericPrizeMultipliers;
  for (const category of NUMERIC_PRIZE_CATEGORIES) {
    const multiplier = raw[category];
    if (!Number.isSafeInteger(multiplier) || (multiplier as number) < 0 || (multiplier as number) > 1_000_000) return null;
    parsed[category] = multiplier as number;
  }
  return parsed;
}

export function createNumericPrizeRuleSnapshot(
  multipliers: NumericPrizeMultipliers = DEFAULT_NUMERIC_PRIZE_MULTIPLIERS,
): { version: string; multipliers: NumericPrizeMultipliers } {
  return { version: NUMERIC_PRIZE_RULE_VERSION, multipliers: { ...multipliers } };
}

export function readNumericPrizeMultipliers(
  ruleVersion: string,
  snapshot: unknown,
): NumericPrizeMultipliers | null {
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const value = snapshot as Record<string, unknown>;
  if (value.version !== ruleVersion || typeof value.version !== "string") return null;
  return parseNumericPrizeMultipliers(value.multipliers);
}
