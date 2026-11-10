import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ loginRateLimit: { getLoginBlock: vi.fn(), recordLoginFailure: vi.fn(), clearLoginFailures: vi.fn() } }));

vi.mock("@/lib/auth/session", () => ({
  authPrisma: { user: { findUnique: vi.fn() } },
  createSession: vi.fn(),
  SESSION_COOKIE: "superquina_session",
}));
vi.mock("@/lib/auth/password", () => ({ verifyPassword: vi.fn() }));
vi.mock("@/lib/auth/login-rate-limit", () => ({
  getLoginBlock: mocks.loginRateLimit.getLoginBlock,
  recordLoginFailure: mocks.loginRateLimit.recordLoginFailure,
  clearLoginFailures: mocks.loginRateLimit.clearLoginFailures,
}));

import { POST } from "./route";
import { authPrisma, createSession } from "@/lib/auth/session";
import { getLoginBlock, recordLoginFailure, clearLoginFailures } from "@/lib/auth/login-rate-limit";
import { verifyPassword } from "@/lib/auth/password";

const userLookup = vi.mocked(authPrisma.user.findUnique);
const sessionCreate = vi.mocked(createSession);
const passwordVerify = vi.mocked(verifyPassword);
const loginBlock = vi.mocked(getLoginBlock);
const loginFailure = vi.mocked(recordLoginFailure);
const clearFailures = vi.mocked(clearLoginFailures);

function request(body: unknown, origin = "https://example.test") {
  return new NextRequest("https://example.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin, host: "example.test" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loginBlock.mockResolvedValue(null);
    loginFailure.mockResolvedValue({ attempts: 1, blockedUntil: null, blocked: false, retryAfterSeconds: 0 });
    clearFailures.mockResolvedValue(undefined);
  });

  it("rejects a cross-origin request before reading credentials", async () => {
    const response = await POST(request({ username: "admin", password: "not-a-password" }, "https://attacker.test"));
    expect(response.status).toBe(403);
    expect(userLookup).not.toHaveBeenCalled();
  });

  it("rejects malformed input without querying users", async () => {
    const response = await POST(request({ username: "", password: "x", role: "ADMIN" }));
    expect(response.status).toBe(400);
    expect(userLookup).not.toHaveBeenCalled();
  });

  it("uses the same generic response for a missing user", async () => {
    userLookup.mockResolvedValue(null);
    passwordVerify.mockResolvedValue(false);
    const response = await POST(request({ username: "unknown", password: "some-password" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Usuário ou senha inválidos." });
    expect(sessionCreate).not.toHaveBeenCalled();
    expect(loginFailure).toHaveBeenCalledWith(expect.anything(), "unknown");
  });

  it("does not create a session for a blocked account", async () => {
    userLookup.mockResolvedValue({ id: "user-1", passwordHash: "encoded", status: "BLOCKED" } as never);
    passwordVerify.mockResolvedValue(true);
    const response = await POST(request({ username: "blocked", password: "some-password" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Usuário ou senha inválidos." });
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it("creates a session only after a valid active-user password", async () => {
    userLookup.mockResolvedValue({ id: "user-1", passwordHash: "encoded", status: "ACTIVE" } as never);
    passwordVerify.mockResolvedValue(true);
    sessionCreate.mockResolvedValue({ token: "opaque-token", expiresAt: new Date("2035-01-01T00:00:00.000Z") });
    const response = await POST(request({ username: "active", password: "some-password" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: true });
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
    expect(response.headers.get("set-cookie")).toContain("opaque-token");
    expect(sessionCreate).toHaveBeenCalledWith("user-1");
    expect(clearFailures).toHaveBeenCalledWith(expect.anything(), "active");
  });

  it("returns 429 with Retry-After when the account is already rate limited", async () => {
    loginBlock.mockResolvedValue({ blockedUntil: new Date(Date.now() + 60_000), retryAfterSeconds: 60 });
    const response = await POST(request({ username: "admin", password: "guess" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(userLookup).not.toHaveBeenCalled();
  });

  it("starts a cooldown when the threshold is reached", async () => {
    userLookup.mockResolvedValue(null);
    passwordVerify.mockResolvedValue(false);
    loginFailure.mockResolvedValue({ attempts: 5, blockedUntil: new Date(Date.now() + 60_000), blocked: true, retryAfterSeconds: 60 });
    const response = await POST(request({ username: "unknown", password: "guess" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });
});
