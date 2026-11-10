import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ purchaseFindUnique: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ authPrisma: { purchase: { findUnique: mocks.purchaseFindUnique } } }));
import { GET } from "./route";
function request(q = "SQ-12345678") { return new NextRequest("https://example.test/api/public/ticket-check?q=" + encodeURIComponent(q)); }
describe("GET /api/public/ticket-check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.purchaseFindUnique.mockResolvedValue({
      status: "CONFIRMED", playerId: "player-1", createdAt: new Date(),
      participations: [{
        round: { code: "JN-01", status: "COMPLETED", resultAt: new Date("2026-11-01T12:00:00Z"), resultNumber: "01234" },
        numericLines: [
          { id: "number-win", numberValue: "01234", prizeCents: 120, prizeCreditedAt: new Date("2026-11-01T12:10:00Z") },
          { id: "number-no-win", numberValue: "99999", prizeCents: 0, prizeCreditedAt: null },
          { id: "number-uncredited-win", numberValue: "00034", prizeCents: 500, prizeCreditedAt: null },
        ],
      }],
    });
  });
  it("requires a complete receipt code and never queries by number", async () => {
    expect((await GET(request("01234"))).status).toBe(400);
    expect(mocks.purchaseFindUnique).not.toHaveBeenCalled();
  });
  it("returns safe numeric results and confirms prizes only after credit", async () => {
    const response = await GET(request("sq-12345678"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.purchaseFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { receiptCode: "SQ-12345678" } }));
    const body = await response.json();
    expect(body.results[0]).toMatchObject({ numberValue: "01234", status: "PREMIADA", prizeCents: 120, resultNumber: "01234" });
    expect(body.results[1]).toMatchObject({ numberValue: "99999", status: "NAO_PREMIADA", prizeCents: null });
    expect(body.results[2]).toMatchObject({ numberValue: "00034", status: "AGUARDANDO_APURACAO", prizeCents: null });
  });
});
