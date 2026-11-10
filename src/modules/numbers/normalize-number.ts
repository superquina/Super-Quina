import { z } from "zod";

export const numberInputSchema = z
  .string()
  .trim()
  .regex(/^\d{5}$/, "Informe exatamente cinco algarismos, de 00000 a 99999.");

export function normalizeNumber(input: string): string {
  return numberInputSchema.parse(input);
}
