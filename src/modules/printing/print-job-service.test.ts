import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("server-only", () => ({}));

import {
  createManualReceiptReprint,
  reserveAutomaticReceiptPrint,
  transitionPrintJob,
} from "./print-job-service";

function confirmedPurchase(overrides: Record<string, unknown> = {}) {
  return {
    id: "purchase-12345678",
    playerId: "player-1",
    cashierId: null,
    createdAt: new Date(),
    status: "CONFIRMED",
    paymentMethod: "PIX",
    receiptCode: "SQ-12345678",
    confirmedAt: new Date(),
    payment: { status: "CONFIRMED", confirmedAt: new Date() },
    ...overrides,
  };
}

describe("print job service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reserves only one automatic print job per confirmed purchase", async () => {
    let stored: Record<string, unknown> | null = null;
    const tx = {
      purchase: { findUnique: vi.fn().mockResolvedValue(confirmedPurchase()) },
      printJob: {
        findUnique: vi.fn().mockImplementation(async () => stored),
        create: vi.fn().mockImplementation(async ({ data }) => {
          stored = { id: "job-1", ...data };
          return stored;
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: unknown) => unknown) => callback(tx)),
      printJob: { findUnique: vi.fn().mockImplementation(async () => stored) },
    } as unknown as PrismaClient;

    const first = await reserveAutomaticReceiptPrint(prisma, "purchase-12345678");
    const second = await reserveAutomaticReceiptPrint(prisma, "purchase-12345678");

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(tx.printJob.create).toHaveBeenCalledTimes(1);
    expect(tx.printJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        purchaseId: "purchase-12345678",
        purpose: "AUTO_RECEIPT",
        autoReceiptKey: "purchase-12345678",
        status: "RESERVED",
      }),
    });
  });

  it("does not reserve automatic printing before definitive confirmation", async () => {
    const tx = {
      purchase: { findUnique: vi.fn().mockResolvedValue(confirmedPurchase({ status: "PENDING_PAYMENT" })) },
      printJob: { findUnique: vi.fn(), create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: unknown) => unknown) => callback(tx)),
      printJob: { findUnique: vi.fn() },
    } as unknown as PrismaClient;

    await expect(reserveAutomaticReceiptPrint(prisma, "purchase-12345678"))
      .rejects.toMatchObject({ code: "RECEIPT_NOT_READY" });
    expect(tx.printJob.create).not.toHaveBeenCalled();
  });

  it("creates a distinct manual reprint audit entry for the purchase owner", async () => {
    const tx = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: "player-1", role: "PLAYER", status: "ACTIVE" }) },
      purchase: { findUnique: vi.fn().mockResolvedValue(confirmedPurchase()) },
      printJob: { create: vi.fn().mockResolvedValue({ id: "manual-job-1", purpose: "MANUAL_REPRINT" }) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaClient;

    const result = await createManualReceiptReprint(prisma, {
      purchaseId: "purchase-12345678",
      actorId: "player-1",
    });
    expect(result).toMatchObject({ id: "manual-job-1", purpose: "MANUAL_REPRINT" });
    expect(tx.printJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        purchaseId: "purchase-12345678",
        purpose: "MANUAL_REPRINT",
        requestedById: "player-1",
      }),
    });
  });

  it("does not allow a user to reprint another user's receipt", async () => {
    const tx = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: "other-player", role: "PLAYER", status: "ACTIVE" }) },
      purchase: { findUnique: vi.fn().mockResolvedValue(confirmedPurchase()) },
      printJob: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(createManualReceiptReprint(prisma, {
      purchaseId: "purchase-12345678",
      actorId: "other-player",
    })).rejects.toMatchObject({ code: "PURCHASE_NOT_FOUND" });
    expect(tx.printJob.create).not.toHaveBeenCalled();
  });

  it("allows a confirmed encoding failure before any transport bytes are sent", async () => {
    const prisma = {
      printJob: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "job-1", status: "FAILED", errorCode: "ENCODING_FAILED" }),
      },
    } as unknown as PrismaClient;

    const result = await transitionPrintJob(prisma, {
      jobId: "job-1",
      nextStatus: "FAILED",
      errorCode: "ENCODING_FAILED",
    });
    expect(result).toMatchObject({ status: "FAILED", errorCode: "ENCODING_FAILED" });
    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "job-1", status: { in: ["RESERVED", "SENDING"] } },
    }));
  });
});
