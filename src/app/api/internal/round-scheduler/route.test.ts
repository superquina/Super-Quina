import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  transaction: vi.fn(),
  createRound: vi.fn(),
  createAuditEvent: vi.fn(),
  closeRound: vi.fn(),
  openRound: vi.fn(),
  drawRoundResults: vi.fn(),
  queryRaw: vi.fn(),
  settleNumericRoundPrizes: vi.fn(),
  paymentFindMany: vi.fn(),
  paymentUpdateMany: vi.fn(),
  reconcilePixPaymentFromProvider: vi.fn(),
  allocatePaidPurchases: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  authPrisma: {
    round: { findUnique: mocks.findUnique, findFirst: mocks.findFirst, findMany: mocks.findMany },
    payment: { findMany: mocks.paymentFindMany, updateMany: mocks.paymentUpdateMany },
    $transaction: mocks.transaction,
    $queryRaw: mocks.queryRaw,
  },
}));
vi.mock("@/modules/rounds/close-round", () => ({ closeRound: mocks.closeRound }));
vi.mock("@/modules/rounds/open-round", () => ({ openRound: mocks.openRound }));
vi.mock("@/modules/rounds/draw-round-results", () => ({ drawRoundResults: mocks.drawRoundResults }));
vi.mock("@/modules/rounds/settle-numeric-round-prizes", () => ({ settleNumericRoundPrizes: mocks.settleNumericRoundPrizes }));
vi.mock("@/modules/payments/reconcile-pix-payment", () => ({ reconcilePixPaymentFromProvider: mocks.reconcilePixPaymentFromProvider }));
vi.mock("@/modules/purchases/allocate-paid-purchases", () => ({ allocatePaidPurchases: mocks.allocatePaidPurchases }));

import { POST } from "./route";

function request(authorization?: string) {
  return new NextRequest("https://example.test/api/internal/round-scheduler", {
    headers: authorization ? { authorization } : {},
  });
}

describe("POST /api/internal/round-scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ROUND_SCHEDULER_SECRET", "test-secret-long-enough");
    mocks.findUnique.mockResolvedValue({ id: "already-scheduled" });
    mocks.findFirst.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue([]);
    mocks.createRound.mockResolvedValue({ id: "created-round" });
    mocks.createAuditEvent.mockResolvedValue({});
    mocks.paymentFindMany.mockResolvedValue([]);
    mocks.queryRaw.mockResolvedValue([]);
    mocks.settleNumericRoundPrizes.mockResolvedValue({ status: "settled", creditedLines: 0 });
    mocks.paymentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.reconcilePixPaymentFromProvider.mockResolvedValue("still_pending");
    mocks.allocatePaidPurchases.mockResolvedValue({ checked: 0, allocated: 0, waiting: 0, failures: 0 });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ round: { create: mocks.createRound }, auditEvent: { create: mocks.createAuditEvent } }),
    );
  });

  it("rejects missing and invalid scheduler credentials", async () => {
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request("Bearer wrong-secret"))).status).toBe(401);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("creates the imminent round when the scheduler starts during its cutoff minute", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T15:29:00.000Z")); // 12:29 in Brasília (UTC-03:00)
    mocks.findUnique.mockImplementation(({ where }: { where: { code: string } }) =>
      where.code === "SQ-20261025-1230" ? null : { id: "already-scheduled" },
    );

    const response = await POST(request("Bearer test-secret-long-enough"));

    expect(response.status).toBe(200);
    expect(mocks.createRound).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        code: "SQ-20261025-1230",
        startsAt: new Date("2026-10-25T15:01:00.000Z"),
        cutoffAt: new Date("2026-10-25T15:29:00.000Z"),
        resultAt: new Date("2026-10-25T15:30:00.000Z"),
        status: "SCHEDULED",
      }),
    }));
    expect(mocks.createAuditEvent).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not duplicate a round already occupying the result time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T15:29:00.000Z"));
    mocks.findMany.mockResolvedValueOnce([{ resultAt: new Date("2026-10-25T15:30:00.000Z") }]);
    mocks.findFirst.mockResolvedValue({ resultAt: new Date("2026-10-25T15:30:00.000Z") });

    const response = await POST(request("Bearer test-secret-long-enough"));

    expect(response.status).toBe(200);
    expect(mocks.createRound.mock.calls.some((call) =>
      (call[0] as { data: { code: string } }).data.code === "SQ-20261025-1230",
    )).toBe(false);
    vi.useRealTimers();
  });

  it("accepts a valid scheduler credential and is idempotent after the schedule is populated", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T15:00:00.000Z"));
    const firstResponse = await POST(request("Bearer test-secret-long-enough"));
    expect(firstResponse.status).toBe(200);
    const scheduledResults = mocks.createRound.mock.calls.map((call) => ({
      resultAt: (call[0] as { data: { resultAt: Date } }).data.resultAt,
    }));
    expect(scheduledResults).toHaveLength(48);
    const resultTimes = scheduledResults.map(({ resultAt }) => resultAt.getTime());
    expect(resultTimes[0]).toBe(new Date("2026-10-25T15:30:00.000Z").getTime());
    expect(resultTimes.at(-1)).toBe(new Date("2026-10-26T15:00:00.000Z").getTime());
    expect(resultTimes.every((time, index) => index === 0 || time - resultTimes[index - 1]! === 30 * 60_000)).toBe(true);

    mocks.findMany.mockResolvedValueOnce(scheduledResults);
    const response = await POST(request("Bearer test-secret-long-enough"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true, created: 0, closed: 0, drawn: 0, prizesSettled: 0, failures: 0, timeZone: "Etc/GMT+3",
      pixChecked: 0, pixConfirmed: 0, pixNeedsReconciliation: 0,
      paidPurchasesChecked: 0, paidPurchasesAllocated: 0, paidPurchasesWaiting: 0,
    });
    expect(mocks.findMany).toHaveBeenCalledTimes(8);
    vi.useRealTimers();
  });

  it("keeps 48 future rounds when the current slot cutoff has just passed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T15:29:30.000Z")); // 12:29:30 in Brasília; 12:30 cutoff has passed
    const response = await POST(request("Bearer test-secret-long-enough"));
    expect(response.status).toBe(200);
    const scheduledResults = mocks.createRound.mock.calls.map((call) =>
      (call[0] as { data: { resultAt: Date } }).data.resultAt.getTime(),
    );
    expect(scheduledResults).toHaveLength(48);
    expect(scheduledResults[0]).toBe(new Date("2026-10-25T16:00:00.000Z").getTime());
    expect(scheduledResults.at(-1)).toBe(new Date("2026-10-26T15:30:00.000Z").getTime());
    expect(scheduledResults.every((time, index) => index === 0 || time - scheduledResults[index - 1]! === 30 * 60_000)).toBe(true);
    vi.useRealTimers();
  });

  it("automatically settles completed rounds and retries them through the scheduler", async () => {
    mocks.queryRaw.mockResolvedValue([{ id: "completed-round-1" }]);
    mocks.settleNumericRoundPrizes.mockResolvedValue({ status: "settled", creditedLines: 1 });

    const response = await POST(request("Bearer test-secret-long-enough"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.settleNumericRoundPrizes).toHaveBeenCalledTimes(1);
    expect(mocks.settleNumericRoundPrizes).toHaveBeenCalledWith(expect.anything(), "completed-round-1");
    expect(body).toMatchObject({ ok: true, prizesSettled: 1, failures: 0 });
  });

  it("reports a settlement failure so the next scheduler run can retry", async () => {
    mocks.queryRaw.mockResolvedValue([{ id: "completed-round-retry" }]);
    mocks.settleNumericRoundPrizes.mockRejectedValue(new Error("temporary settlement failure"));

    const response = await POST(request("Bearer test-secret-long-enough"));
    const body = await response.json();

    expect(response.status).toBe(207);
    expect(mocks.settleNumericRoundPrizes).toHaveBeenCalledWith(expect.anything(), "completed-round-retry");
    expect(body).toMatchObject({ ok: false, prizesSettled: 0, failures: 1 });
  });

  it("reconciles pending Pix payments even when no browser is polling", async () => {
    mocks.paymentFindMany.mockResolvedValue([{ id: "payment-pending-1" }]);
    mocks.reconcilePixPaymentFromProvider.mockResolvedValue("confirmed");
    const response = await POST(request("Bearer test-secret-long-enough"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.paymentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "payment-pending-1", status: "PENDING" }),
    }));
    expect(mocks.reconcilePixPaymentFromProvider).toHaveBeenCalledWith(expect.anything(), "payment-pending-1");
    expect(body).toMatchObject({ pixChecked: 1, pixConfirmed: 1, pixNeedsReconciliation: 0 });
  });

});
