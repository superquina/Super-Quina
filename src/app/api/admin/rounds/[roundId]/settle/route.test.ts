import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ getSessionUser: vi.fn(), settleNumericRoundPrizes: vi.fn(), auditCreate: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: mocks.getSessionUser, authPrisma: { auditEvent: { create: mocks.auditCreate } }, SESSION_COOKIE: "superquina_session" }));
vi.mock("@/modules/rounds/settle-numeric-round-prizes", () => ({ settleNumericRoundPrizes: mocks.settleNumericRoundPrizes }));
vi.mock("@/modules/rounds/round-settlement-error", () => ({
  RoundSettlementError: class RoundSettlementError extends Error {
    code: string;
    constructor(message: string, code: string) { super(message); this.code = code; }
  },
}));
import { POST } from "./route";
import { RoundSettlementError } from "@/modules/rounds/round-settlement-error";
function request(origin: string | null = "https://example.test", token = "session-token", host: string | null = "example.test") {
  const headers: Record<string, string> = {};
  if (origin) headers.origin = origin;
  if (host) headers.host = host;
  if (token) headers.cookie = `superquina_session=${token}`;
  return new NextRequest("http://internal-next/api/admin/rounds/round-123456/settle", {
    method: "POST",
    headers,
  });
}
const context = { params: Promise.resolve({ roundId: "round-123456" }) };
describe("POST /api/admin/rounds/[roundId]/settle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: "admin-1", username: "admin", role: "ADMIN", status: "ACTIVE", mustChangePassword: false });
    mocks.settleNumericRoundPrizes.mockResolvedValue({ roundId: "round-123456", status: "settled", eligibleLines: 2, creditedLines: 1, pendingManualPayouts: 0, totalPrizeCents: 1200 });
  });
  it.each([
    ["missing Origin", null, "example.test"],
    ["missing Host", "https://example.test", null],
  ])("rejects requests with %s", async (_label, origin, host) => {
    const result = await POST(request(origin, "session-token", host), context);
    expect(result.status).toBe(403);
    expect(mocks.getSessionUser).not.toHaveBeenCalled();
    expect(mocks.settleNumericRoundPrizes).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests", async () => { expect((await POST(request("https://attacker.test"), context)).status).toBe(403); expect(mocks.settleNumericRoundPrizes).not.toHaveBeenCalled(); });
  it("requires a valid session", async () => { mocks.getSessionUser.mockResolvedValue(null); expect((await POST(request(), context)).status).toBe(401); });
  it("rejects non-admin roles", async () => { mocks.getSessionUser.mockResolvedValue({ id: "p", role: "PLAYER", mustChangePassword: false }); expect((await POST(request(), context)).status).toBe(403); });
  it("requires a valid round id", async () => { expect((await POST(request(), { params: Promise.resolve({ roundId: "!" }) })).status).toBe(400); });
  it("settles numeric prizes as an admin", async () => {
    const result = await POST(request(), context);
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(mocks.settleNumericRoundPrizes).toHaveBeenCalledWith(expect.anything(), "round-123456", "admin-1");
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
  it("maps an unpublished draw to conflict", async () => {
    mocks.settleNumericRoundPrizes.mockRejectedValue(new RoundSettlementError("not drawn", "ROUND_NOT_DRAWN"));
    expect((await POST(request(), context)).status).toBe(409);
  });
});
