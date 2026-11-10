import { describe, expect, it, vi } from "vitest";
import { allocatePaidPurchases } from "./allocate-paid-purchases";

describe("allocatePaidPurchases bounded retry cursor", () => {
  it("caps one scheduler execution at 100 purchases and persists its cursor after failures", async () => {
    const firstBatch = Array.from({ length: 50 }, (_, index) => ({ id: `purchase-${String(index + 1).padStart(3, "0")}` }));
    const secondBatch = Array.from({ length: 50 }, (_, index) => ({ id: `purchase-${String(index + 51).padStart(3, "0")}` }));
    const findMany = vi.fn().mockResolvedValueOnce(firstBatch).mockResolvedValueOnce(secondBatch);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      setting: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany,
      },
      purchase: { findMany },
      $transaction: vi.fn().mockRejectedValue(new Error("temporary database failure")),
    };

    const result = await allocatePaidPurchases(prisma as never, 50);

    expect(result).toEqual({ checked: 100, allocated: 0, waiting: 0, failures: 100 });
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { key: "paid_purchase_allocation_cursor", value: "purchase-050" },
      data: { value: "purchase-100" },
    });
  });

  it("wraps the cursor when it reaches the end so failed purchases are retried", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      setting: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue({ value: "purchase-100" }),
        updateMany,
      },
      purchase: { findMany },
      $transaction: vi.fn(),
    };

    const result = await allocatePaidPurchases(prisma as never, 50);

    expect(result).toEqual({ checked: 0, allocated: 0, waiting: 0, failures: 0 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { gt: "purchase-100" } }),
    }));
    expect(updateMany).toHaveBeenCalledWith({
      where: { key: "paid_purchase_allocation_cursor", value: "purchase-100" },
      data: { value: "" },
    });
  });
});
