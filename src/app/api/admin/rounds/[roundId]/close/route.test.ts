import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  closeRound: vi.fn(),
  auditCreate: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: mocks.getSessionUser,
  authPrisma: { auditEvent: { create: mocks.auditCreate } },
  SESSION_COOKIE: "superquina_session",
}));
vi.mock("@/modules/rounds/close-round", () => ({
  closeRound: mocks.closeRound,
  RoundClosureError: class RoundClosureError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "RoundClosureError";
      this.code = code;
    }
  },
}));

import { POST } from "./route";
import { RoundClosureError } from "@/modules/rounds/close-round";

function request(origin: string | null = "https://example.test", token = "session-token", host: string | null = "example.test") {
  const headers: Record<string, string> = {};
  if (origin) headers.origin = origin;
  if (host) headers.host = host;
  if (token) headers.cookie = `superquina_session=${token}`;
  return new NextRequest("http://internal-next/api/admin/rounds/round-123456/close", {
    method: "POST",
    headers,
  });
}
const context = { params: Promise.resolve({ roundId: "round-123456" }) };

describe("POST /api/admin/rounds/[roundId]/close", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({
      id: "admin-1", username: "admin", role: "ADMIN", status: "ACTIVE", mustChangePassword: false,
    });
    mocks.closeRound.mockResolvedValue({ id: "round-123456", code: "R-12:30", status: "CLOSED" });
    mocks.auditCreate.mockResolvedValue({});
  });

  it.each([
    ["missing Origin", null, "example.test"],
    ["missing Host", "https://example.test", null],
  ])("rejects requests with %s", async (_label, origin, host) => {
    const result = await POST(request(origin, "session-token", host), context);
    expect(result.status).toBe(403);
    expect(mocks.getSessionUser).not.toHaveBeenCalled();
    expect(mocks.closeRound).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests", async () => {
    const result = await POST(request("https://attacker.test"), context);
    expect(result.status).toBe(403);
    expect(mocks.getSessionUser).not.toHaveBeenCalled();
    expect(mocks.closeRound).not.toHaveBeenCalled();
  });

  it("requires a valid session", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const result = await POST(request(), context);
    expect(result.status).toBe(401);
    expect(mocks.closeRound).not.toHaveBeenCalled();
  });

  it.each(["PLAYER", "CASHIER"])("rejects role %s and audits the denial", async (role) => {
    mocks.getSessionUser.mockResolvedValue({
      id: "user-1", username: "user", role, status: "ACTIVE", mustChangePassword: false,
    });
    const result = await POST(request(), context);
    expect(result.status).toBe(403);
    expect(mocks.closeRound).not.toHaveBeenCalled();
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: { actorId: "user-1", action: "ROUND_CLOSE_DENIED", entityType: "Round", metadata: { reason: "insufficient_role" } },
    });
  });

  it("requires initial password change before privileged actions", async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: "admin-1", username: "admin", role: "ADMIN", status: "ACTIVE", mustChangePassword: true,
    });
    const result = await POST(request(), context);
    expect(result.status).toBe(403);
    expect(mocks.closeRound).not.toHaveBeenCalled();
  });

  it("rejects malformed round identifiers", async () => {
    const result = await POST(request(), { params: Promise.resolve({ roundId: "!" }) });
    expect(result.status).toBe(400);
    expect(mocks.closeRound).not.toHaveBeenCalled();
  });

  it("allows only an active admin to close a round and returns no-cache response", async () => {
    const result = await POST(request(), context);
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toEqual({ closed: true, round: { id: "round-123456", code: "R-12:30", status: "CLOSED" } });
    expect(mocks.closeRound).toHaveBeenCalledWith(expect.anything(), "round-123456", undefined, "admin-1");
  });

  it("maps a round that is not yet closable to conflict", async () => {
    mocks.closeRound.mockRejectedValue(new RoundClosureError("not yet", "CUTOFF_NOT_REACHED"));
    const result = await POST(request(), context);
    expect(result.status).toBe(409);
    expect(mocks.closeRound).toHaveBeenCalledOnce();
  });
});
