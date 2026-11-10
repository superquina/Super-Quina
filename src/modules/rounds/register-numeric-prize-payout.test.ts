import { describe, expect, it, vi } from "vitest";
import { registerNumericPrizePayout } from "./register-numeric-prize-payout";
import { createNumericPrizeRuleSnapshot, NUMERIC_PRIZE_RULE_VERSION } from "../../domain/numeric-prize-rules";

function makeLine(overrides: Record<string, unknown> = {}) {
  return {
    id: "line-12345678",
    numberValue: "01234",
    prizeCents: 5000,
    prizeCreditedAt: null,
    unitCents: 1000, tensCents: 0, hundredsCents: 0, thousandsCents: 0, quinaCents: 0,
    ruleVersion: NUMERIC_PRIZE_RULE_VERSION,
    ruleSnapshot: createNumericPrizeRuleSnapshot(),
    prizePayout: null,
    participation: {
      status: "CONFIRMED",
      purchase: {
        id: "purchase-123",
        receiptCode: "SQ-12345678",
        cashierId: "cashier-123",
        playerId: null,
        status: "CONFIRMED",
        confirmedAt: new Date("2026-11-06T12:00:00.000Z"),
      },
      round: { id: "round-123", code: "SQ-ROUND-01", status: "COMPLETED", resultNumber: "99314" },
    },
    ...overrides,
  };
}

function setup(line = makeLine()) {
  const payoutCreate = vi.fn().mockResolvedValue({
    id: "payout-123", participationLineId: "line-12345678",
    channel: "PLATFORM_PIX", amountCents: 5000,
    paidAt: new Date("2026-11-06T12:30:00.000Z"), reference: null,
  });
  const auditCreate = vi.fn().mockResolvedValue({});
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    numericParticipationLine: { findUnique: vi.fn().mockResolvedValue(line) },
    numericPrizePayout: { create: payoutCreate },
    auditEvent: { create: auditCreate },
  };
  return { tx, payoutCreate, auditCreate };
}

describe("registerNumericPrizePayout", () => {
  it("allows external payout for a confirmed cashier ticket", async () => {
    const { tx, payoutCreate, auditCreate } = setup();
    const result = await registerNumericPrizePayout(tx as never, {
      lineId: "line-12345678", actorId: "admin-123", channel: "PLATFORM_PIX",
    });
    expect(result.amountCents).toBe(5000);
    expect(payoutCreate).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledOnce();
  });


  it("blocks payout when the stored prize differs from the deterministic result", async () => {
    const { tx, payoutCreate, auditCreate } = setup(makeLine({ prizeCents: 1000 }));
    await expect(registerNumericPrizePayout(tx as never, {
      lineId: "line-12345678", actorId: "admin-123", channel: "PLATFORM_PIX",
    })).rejects.toMatchObject({ code: "INCONSISTENT_PRIZE" });
    expect(payoutCreate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("rejects external payout for an online player's prize", async () => {
    const { tx, payoutCreate, auditCreate } = setup(makeLine({
      participation: {
        status: "CONFIRMED",
        purchase: {
          id: "purchase-online", receiptCode: "SQ-12345678",
          cashierId: null, playerId: "player-123",
          status: "CONFIRMED", confirmedAt: new Date(),
        },
        round: { id: "round-123", code: "SQ-ROUND-01", status: "COMPLETED", resultNumber: "99314" },
      },
    }));
    await expect(registerNumericPrizePayout(tx as never, {
      lineId: "line-12345678", actorId: "admin-123", channel: "PLATFORM_PIX",
    })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    expect(payoutCreate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("rejects a prize already credited or manually paid", async () => {
    const credited = setup(makeLine({ prizeCreditedAt: new Date() }));
    await expect(registerNumericPrizePayout(credited.tx as never, {
      lineId: "line-12345678", actorId: "admin-123", channel: "PLATFORM_PIX",
    })).rejects.toMatchObject({ code: "ALREADY_PAID" });

    const paid = setup(makeLine({ prizePayout: { id: "existing-payout" } }));
    await expect(registerNumericPrizePayout(paid.tx as never, {
      lineId: "line-12345678", actorId: "admin-123", channel: "PLATFORM_PIX",
    })).rejects.toMatchObject({ code: "ALREADY_PAID" });
  });

  it("requires the cashier to own the ticket before recording cash payout", async () => {
    const { tx, payoutCreate } = setup();
    await expect(registerNumericPrizePayout(tx as never, {
      lineId: "line-12345678", actorId: "cashier-456",
      cashierId: "cashier-456", channel: "CASHIER_CASH",
    })).rejects.toMatchObject({ code: "NOT_OWNED" });
    expect(payoutCreate).not.toHaveBeenCalled();
  });
});
