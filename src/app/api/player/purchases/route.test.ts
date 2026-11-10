import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  createNumericPurchase: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  authPrisma: {},
  getSessionUser: mocks.getSessionUser,
  SESSION_COOKIE: "superquina_session",
}));
vi.mock("@/modules/purchases/create-numeric-purchase", () => ({
  createNumericPurchase: mocks.createNumericPurchase,
}));
vi.mock("@/modules/purchases/purchase-service-error", () => ({
  PurchaseServiceError: class PurchaseServiceError extends Error {
    code: string;
    constructor(message: string, code: string) { super(message); this.code = code; }
  },
}));

import { POST } from "./route";

function request(body: unknown, options: { origin?: string; token?: string } = {}) {
  return new NextRequest("http://internal-next/api/player/purchases", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "example.test",
      ...(options.origin === undefined ? { origin: "https://example.test" } : { origin: options.origin }),
      ...(options.token === undefined ? { cookie: "superquina_session=session-token" } : options.token ? { cookie: `superquina_session=${options.token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
const validBody = () => ({
  idempotencyKey: "idempotency-key-0001",
  repetitionCount: 1,
  numbers: ["01234"],
  stakeCents: 100,
  paymentMethod: "PIX",
});
const purchase = () => ({
  id: "purchase-1", receiptCode: null, status: "PENDING_PAYMENT",
  payment: { status: "PENDING", idempotencyKey: "payment-key", providerPaymentId: null },
  totalCents: 100, currency: "BRL",
  numericIntent: { roundCount: 1, numbers: ["01234"], allocation: { unitCents: 20, tensCents: 20, hundredsCents: 20, thousandsCents: 20, quinaCents: 20 } },
  participations: [],
});

describe("POST /api/player/purchases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({
      id: "player-1", username: "player", role: "PLAYER", status: "ACTIVE", mustChangePassword: false,
    });
    mocks.createNumericPurchase.mockResolvedValue(purchase());
  });

  it("rejects cross-origin requests", async () => {
    const response = await POST(request(validBody(), { origin: "https://attacker.test" }));
    expect(response.status).toBe(403);
    expect(mocks.getSessionUser).not.toHaveBeenCalled();
    expect(mocks.createNumericPurchase).not.toHaveBeenCalled();
  });

  it("accepts same-origin requests forwarded by an internal reverse proxy", async () => {
    const response = await POST(request(validBody()));
    expect(response.status).toBe(201);
    expect(mocks.createNumericPurchase).toHaveBeenCalledOnce();
  });

  it("requires an authenticated session", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const response = await POST(request(validBody()));
    expect(response.status).toBe(401);
    expect(mocks.createNumericPurchase).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "CASHIER"])("rejects role %s", async (role) => {
    mocks.getSessionUser.mockResolvedValue({
      id: "user-1", username: "user", role, status: "ACTIVE", mustChangePassword: false,
    });
    const response = await POST(request(validBody()));
    expect(response.status).toBe(403);
    expect(mocks.createNumericPurchase).not.toHaveBeenCalled();
  });

  it("rejects malformed numeric payloads and invalid round counts", async () => {
    const malformed = await POST(request({ ...validBody(), extra: true }));
    expect(malformed.status).toBe(400);
    const invalidNumber = await POST(request({ ...validBody(), numbers: ["1234A"] }));
    expect(invalidNumber.status).toBe(400);
    const invalidCount = await POST(request({ ...validBody(), repetitionCount: 11 }));
    expect(invalidCount.status).toBe(400);
    const obsoleteRoundIds = await POST(request({ ...validBody(), roundIds: ["round-1"] }));
    expect(obsoleteRoundIds.status).toBe(400);
    expect(mocks.createNumericPurchase).not.toHaveBeenCalled();
  });

  it("creates a pending numeric purchase with server-owned multipliers and five-part allocation", async () => {
    const response = await POST(request(validBody()));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.createNumericPurchase).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      playerId: "player-1", paymentMethod: "PIX", roundCount: 1,
      numbers: ["01234"], stakeCents: 100,
    }));
    const body = await response.json();
    expect(body.purchase.totalCents).toBe(100);
    expect(body.purchase.participations).toEqual([]);
    expect(body.purchase.numericIntent).toMatchObject({ repetitionCount: 1, numbers: ["01234"] });
    expect(body.purchase.receiptCode).toBeNull();
    expect(body.message).toContain("Nenhum recibo foi emitido");
    expect(body.paymentActionRequired).toBe(true);
    expect(body.message).toContain("A cobrança Pix ainda não foi criada");
  });

  it("reuses the same idempotency key for retries", async () => {
    await POST(request(validBody()));
    await POST(request(validBody()));
    const first = mocks.createNumericPurchase.mock.calls[0]![1];
    const second = mocks.createNumericPurchase.mock.calls[1]![1];
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(second.numbers).toEqual(["01234"]);
  });

  it("does not expose internal errors for unexpected failures", async () => {
    mocks.createNumericPurchase.mockRejectedValue(new Error("database secret"));
    const response = await POST(request(validBody()));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Não foi possível registrar a compra agora." });
  });
});
