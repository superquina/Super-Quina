import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/session", () => ({
  authPrisma: { user: { findUnique: vi.fn(), create: vi.fn() } },
  createSession: vi.fn(),
  SESSION_COOKIE: "superquina_session",
}));
vi.mock("@/lib/auth/password", () => ({ hashPassword: vi.fn() }));

import { POST } from "./route";
import { authPrisma, createSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";

const userLookup = vi.mocked(authPrisma.user.findUnique);
const userCreate = vi.mocked(authPrisma.user.create);
const sessionCreate = vi.mocked(createSession);
const passwordHash = vi.mocked(hashPassword);

function request(body: unknown, origin = "https://example.test") {
  return new NextRequest("https://example.test/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", origin, host: "example.test" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userLookup.mockResolvedValue(null);
    passwordHash.mockResolvedValue("scrypt$encoded");
    userCreate.mockResolvedValue({ id: "player-1" } as never);
    sessionCreate.mockResolvedValue({
      token: "opaque-token",
      expiresAt: new Date("2035-01-01T00:00:00.000Z"),
    });
  });

  it("rejects cross-origin requests", async () => {
    const response = await POST(request(
      { username: "player", password: "a-long-secure-password" },
      "https://attacker.test",
    ));
    expect(response.status).toBe(403);
    expect(userLookup).not.toHaveBeenCalled();
  });

  it("rejects invalid input and attempts to set privileged fields", async () => {
    const response = await POST(request({
      username: "ab",
      password: "short",
      role: "ADMIN",
    }));
    expect(response.status).toBe(400);
    expect(userCreate).not.toHaveBeenCalled();
  });

  it("normalizes the username and creates only an active player account", async () => {
    const response = await POST(request({
      username: "  Novo.Jogador  ",
      password: "uma-senha-segura-123",
    }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ created: true });
    expect(userLookup).toHaveBeenCalledWith({
      where: { username: "novo.jogador" },
      select: { id: true },
    });
    expect(passwordHash).toHaveBeenCalledWith("uma-senha-segura-123");
    expect(userCreate).toHaveBeenCalledWith({
      data: {
        username: "novo.jogador",
        passwordHash: "scrypt$encoded",
        role: "PLAYER",
        status: "ACTIVE",
      },
      select: { id: true },
    });
    expect(sessionCreate).toHaveBeenCalledWith("player-1");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
    expect(response.headers.get("set-cookie")).toContain("opaque-token");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not create a duplicate username", async () => {
    userLookup.mockResolvedValue({ id: "existing-player" } as never);
    const response = await POST(request({
      username: "existing",
      password: "uma-senha-segura-123",
    }));
    expect(response.status).toBe(409);
    expect(userCreate).not.toHaveBeenCalled();
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it("handles concurrent duplicate usernames safely", async () => {
    userCreate.mockRejectedValue({ code: "P2002" });
    const response = await POST(request({
      username: "race-user",
      password: "uma-senha-segura-123",
    }));
    expect(response.status).toBe(409);
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it("returns a generic error when account creation fails", async () => {
    userCreate.mockRejectedValue(new Error("database detail"));
    const response = await POST(request({
      username: "new-player",
      password: "uma-senha-segura-123",
    }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Não foi possível criar sua conta agora. Tente novamente.",
    });
  });
});
