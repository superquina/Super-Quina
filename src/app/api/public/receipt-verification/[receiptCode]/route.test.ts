import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ purchaseFindUnique: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  authPrisma: { purchase: { findUnique: mocks.purchaseFindUnique } },
}));

import { GET } from "./route";

const context = (receiptCode = "SQ-12345678") => ({ params: Promise.resolve({ receiptCode }) });
const request = new NextRequest("https://example.test/api/public/receipt-verification/SQ-12345678");
const future = new Date(Date.now() + 60 * 60_000);
const past = new Date(Date.now() - 60 * 60_000);

function purchase(overrides: Record<string, unknown> = {}) {
  return {
    receiptCode: "SQ-12345678",
    status: "CONFIRMED",
    paymentMethod: "PIX",
    totalCents: 500,
    currency: "BRL",
    confirmedAt: new Date("2026-11-01T12:00:00Z"),
    payment: { status: "CONFIRMED", confirmedAt: new Date("2026-11-01T12:00:00Z") },
    participations: [{
      round: { code: "SQ-ROUND-01", status: "COMPLETED", resultNumber: "01234", startsAt: past, resultAt: past },
      numericLines: [
        { numberValue: "01234", unitCents: 0, tensCents: 0, hundredsCents: 0, thousandsCents: 0, quinaCents: 0, ruleVersion: 1, ruleSnapshot: {}, prizeCents: 100, prizeCreditedAt: new Date() },
        { numberValue: "00007", unitCents: 0, tensCents: 0, hundredsCents: 0, thousandsCents: 0, quinaCents: 0, ruleVersion: 1, ruleSnapshot: {}, prizeCents: 0, prizeCreditedAt: null },
      ],
    }],
    ...overrides,
  };
}

describe("GET /api/public/receipt-verification/[receiptCode]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.purchaseFindUnique.mockResolvedValue(purchase());
  });

  it("rejects malformed receipt codes without querying the database", async () => {
    const response = await GET(request, context("not-a-receipt"));
    expect(response.status).toBe(400);
    expect(mocks.purchaseFindUnique).not.toHaveBeenCalled();
  });

  it("returns not found for an unknown receipt", async () => {
    mocks.purchaseFindUnique.mockResolvedValue(null);
    expect((await GET(request, context())).status).toBe(404);
  });

  it("does not validate an unpaid Pix purchase as a paid receipt", async () => {
    mocks.purchaseFindUnique.mockResolvedValue(purchase({
      payment: { status: "PENDING", confirmedAt: null },
    }));
    const body = await (await GET(request, context())).json();
    expect(body.valid).toBe(false);
    expect(body.message).toContain("pagamento não está confirmado");
  });

  it.each(["CASH", "WALLET"])("accepts confirmed %s purchases without a Pix payment record", async (paymentMethod) => {
    mocks.purchaseFindUnique.mockResolvedValue(purchase({ paymentMethod, payment: null }));
    const body = await (await GET(request, context())).json();
    expect(body.valid).toBe(true);
  });

  it("preserves leading zeroes and reports winning and non-winning numbers", async () => {
    const body = await (await GET(request, context("sq-12345678"))).json();
    expect(body.valid).toBe(true);
    expect(body.rounds[0].resultNumber).toBe("01234");
    expect(body.rounds[0].numbers[0]).toMatchObject({ numberValue: "01234", resultStatus: "PREMIADA", prizePaid: true });
    expect(body.rounds[0].numbers[1]).toMatchObject({ numberValue: "00007", resultStatus: "NAO_PREMIADA" });
  });

  it("marks rounds before their result time as awaiting the draw", async () => {
    mocks.purchaseFindUnique.mockResolvedValue(purchase({
      participations: [{ round: { code: "SQ-ROUND-02", status: "OPEN", resultNumber: null, startsAt: future, resultAt: future }, numericLines: [
        { numberValue: "00007", unitCents: 0, tensCents: 0, hundredsCents: 0, thousandsCents: 0, quinaCents: 0, ruleVersion: 1, ruleSnapshot: {}, prizeCents: null, prizeCreditedAt: null },
      ] }],
    }));
    const body = await (await GET(request, context())).json();
    expect(body.rounds[0]).toMatchObject({ status: "SORTEIO_AGUARDANDO", resultNumber: null });
    expect(body.rounds[0].numbers[0].resultStatus).toBe("AGUARDANDO");
  });

  it("distinguishes cancelled rounds and completed rounds awaiting prize calculation", async () => {
    mocks.purchaseFindUnique.mockResolvedValue(purchase({
      participations: [
        { round: { code: "SQ-CANCEL", status: "CANCELLED", resultNumber: null, startsAt: past, resultAt: past }, numericLines: [] },
        { round: { code: "SQ-APUR", status: "COMPLETED", resultNumber: "54321", startsAt: past, resultAt: past }, numericLines: [
          { numberValue: "00007", unitCents: 0, tensCents: 0, hundredsCents: 0, thousandsCents: 0, quinaCents: 0, ruleVersion: 1, ruleSnapshot: {}, prizeCents: null, prizeCreditedAt: null },
        ] },
      ],
    }));
    const body = await (await GET(request, context())).json();
    expect(body.rounds[0].status).toBe("RODADA_CANCELADA");
    expect(body.rounds[1].numbers[0].resultStatus).toBe("AGUARDANDO_APURACAO");
  });
});
