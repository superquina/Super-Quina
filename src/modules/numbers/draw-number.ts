import { randomInt } from "node:crypto";

export type RandomInteger = (maxExclusive: number) => number;

/** Draws one uniformly distributed five-digit value, preserving leading zeroes. */
export function drawNumber(nextInt: RandomInteger = randomInt): string {
  return nextInt(100_000).toString().padStart(5, "0");
}
