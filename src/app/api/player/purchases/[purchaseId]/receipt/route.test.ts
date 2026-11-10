import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ getSessionUser: vi.fn(), purchaseFindFirst: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ authPrisma: { purchase: { findFirst: mocks.purchaseFindFirst } }, getSessionUser: mocks.getSessionUser, SESSION_COOKIE: "superquina_session" }));
import { GET } from "./route";
function request(token = "session-token") { return new NextRequest("https://example.test/api/player/purchases/purchase-12345678/receipt", { headers: token ? { cookie: "superquina_session=" + token } : {} }); }
const context = { params: Promise.resolve({ purchaseId: "purchase-12345678" }) };
const confirmedPurchase = () => ({
  id: "purchase-12345678", createdAt: new Date(), playerId: "player-1", cashierId: "cashier-1",
  status: "CONFIRMED", paymentMethod: "PIX", totalCents: 200, currency: "BRL",
  receiptCode: "SQ-12345678", confirmedAt: new Date("2026-10-25T12:00:00.000Z"),
  payment: { status: "CONFIRMED", confirmedAt: new Date("2026-10-25T12:00:00.000Z") },
  participations: [{
    round: { code: "JN-20261101-1230", resultAt: new Date("2026-11-01T12:30:00.000Z") },
    numericLines: [
      { numberValue: "00007", unitCents: 20, tensCents: 20, hundredsCents: 20, thousandsCents: 20, quinaCents: 20 },
      { numberValue: "12345", unitCents: 20, tensCents: 20, hundredsCents: 20, thousandsCents: 20, quinaCents: 20 },
    ],
  }],
});
describe("GET purchase receipt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: "cashier-1", username: "cashier", role: "CASHIER", status: "ACTIVE", mustChangePassword: false });
    mocks.purchaseFindFirst.mockResolvedValue(confirmedPurchase());
  });
  it("allows a player to read only their own confirmed receipt", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "player-1", username: "player", role: "PLAYER", status: "ACTIVE", mustChangePassword: false });
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.purchaseFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "purchase-12345678", playerId: "player-1" },
    }));
  });
  it("does not expose another player's receipt", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "other-player", username: "other", role: "PLAYER", status: "ACTIVE", mustChangePassword: false });
    mocks.purchaseFindFirst.mockResolvedValue(null);
    expect((await GET(request(), context)).status).toBe(404);
    expect(mocks.purchaseFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "purchase-12345678", playerId: "other-player" },
    }));
  });
  it("refuses receipt reprints after seven days", async () => {
    mocks.purchaseFindFirst.mockResolvedValue({ ...confirmedPurchase(), createdAt: new Date(Date.now() - 8 * 86400000) });
    expect((await GET(request(), context)).status).toBe(410);
  });
  it("returns only numeric entries for a confirmed purchase", async () => {
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(await response.json()).toMatchObject({ receipt: { receiptCode: "SQ-12345678", totalCents: 200, entries: [
      { numberValue: "00007", stakeCents: 100 }, { numberValue: "12345", stakeCents: 100 },
    ] } });
  });
});
