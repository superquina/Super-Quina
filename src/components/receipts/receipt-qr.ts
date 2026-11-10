import qrcode from "qrcode-generator";

/** Creates a self-contained image data URL without a remote QR rendering service. */
export function createReceiptQrDataUrl(verificationUrl: string): string {
  const qr = qrcode(0, "M");
  qr.addData(verificationUrl);
  qr.make();
  return qr.createDataURL(5, 4);
}
