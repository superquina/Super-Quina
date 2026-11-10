import { describe, expect, it } from "vitest";
import { createReceiptQrDataUrl } from "./receipt-qr";

describe("createReceiptQrDataUrl", () => {
  it("generates an embedded image for the internal receipt verification URL", () => {
    const dataUrl = createReceiptQrDataUrl("https://superquina.example/verificar-recibo/SQ-ABC12345");
    expect(dataUrl).toMatch(/^data:image\/gif;base64,/);
    expect(dataUrl).not.toContain("api.qrserver.com");
  });
});
