import { describe, expect, it } from "vitest";
import { drawNumber } from "./draw-number";

describe("drawNumber", () => {
  it("preserves leading zeroes", () => {
    expect(drawNumber(() => 7)).toBe("00007");
  });

  it("supports the upper boundary", () => {
    expect(drawNumber(() => 99_999)).toBe("99999");
  });

  it("uses exactly the 100,000-value range", () => {
    let requestedRange = 0;
    drawNumber((maxExclusive) => { requestedRange = maxExclusive; return 0; });
    expect(requestedRange).toBe(100_000);
  });
});
