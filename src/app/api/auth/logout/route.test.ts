import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/session", () => ({
  revokeSession: vi.fn(),
  SESSION_COOKIE: "superquina_session",
}));
import { POST } from "./route";
import { revokeSession } from "@/lib/auth/session";

const revoke = vi.mocked(revokeSession);

describe("POST /api/auth/logout", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects cross-origin logout requests", async () => {
    const request = new NextRequest("https://example.test/api/auth/logout", {
      method: "POST",
      headers: { origin: "https://attacker.test" },
    });
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("revokes the presented session and clears its cookie", async () => {
    revoke.mockResolvedValue(undefined);
    const request = new NextRequest("https://example.test/api/auth/logout", {
      method: "POST",
      headers: { origin: "https://example.test", host: "example.test", cookie: "superquina_session=opaque-token" },
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(revoke).toHaveBeenCalledWith("opaque-token");
    expect(response.headers.get("set-cookie")).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  });
});
