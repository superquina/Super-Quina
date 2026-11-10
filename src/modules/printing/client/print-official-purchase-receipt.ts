"use client";
import { encodeThermalReceipt } from "@/modules/printing/escpos/encode-thermal-receipt";
import { getSuperQuinaPrinter } from "@/modules/printing/client/superquina-printer-bridge";

type OfficialReceipt = Parameters<typeof encodeThermalReceipt>[0];
type PrintJobResponse = { created: boolean; job: { id: string; status: string; purpose: string }; maySend: boolean };

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a operação.");
  return payload;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function transition(
  jobId: string,
  nextStatus: "SENDING" | "SENT" | "FAILED" | "UNKNOWN",
  deviceName: string,
  errorCode?: string,
) {
  return postJson("/api/print-jobs/" + encodeURIComponent(jobId) + "/transition", {
    nextStatus,
    deviceName,
    ...(errorCode ? { errorCode } : {}),
  });
}

/**
 * The website remains the only receipt renderer/source of truth.
 * Fetches the official server receipt, encodes ESC/POS and sends it through
 * native Bluetooth SPP. It never invokes Android Print Framework or PDF.
 */
export async function printOfficialPurchaseReceipt(input: {
  purchaseId: string;
  deviceId: string;
  deviceName: string;
  profile: import("@/modules/printing/escpos/encode-thermal-receipt").EscPosProfile;
}): Promise<{ jobId: string; bytesWritten: number }> {
  // Validate native runtime and printer session BEFORE reserving a job.
  const printer = getSuperQuinaPrinter();
  let state: Awaited<ReturnType<typeof printer.getConnectionState>>;
  try {
    state = await printer.getConnectionState();
  } catch {
    throw new Error("Não foi possível verificar a conexão Bluetooth. Abra o Super Quina no aplicativo e conecte a impressora.");
  }
  if (!state.connected || state.deviceId !== input.deviceId) {
    throw new Error("Conecte a impressora selecionada antes de imprimir.");
  }

  const reservation = await postJson<PrintJobResponse>(
    "/api/purchases/" + encodeURIComponent(input.purchaseId) + "/print-jobs/auto",
    {},
  );
  if (!reservation.created || !reservation.maySend || reservation.job.status !== "RESERVED") {
    throw new Error("Este recibo já foi enviado ou está em processamento. Não será impresso novamente automaticamente.");
  }

  let receipt: OfficialReceipt;
  try {
    const response = await fetch(
      "/api/player/purchases/" + encodeURIComponent(input.purchaseId) + "/receipt",
      { credentials: "same-origin", cache: "no-store" },
    );
    const payload = await response.json() as { receipt?: OfficialReceipt; error?: string };
    if (!response.ok || !payload.receipt) {
      throw new Error(payload.error || "Recibo oficial indisponível.");
    }
    receipt = payload.receipt;
  } catch (error) {
    await transition(reservation.job.id, "FAILED", input.deviceName, "RECEIPT_UNAVAILABLE");
    throw error;
  }

  let encoded: Uint8Array;
  try {
    encoded = encodeThermalReceipt(receipt, input.profile);
  } catch (error) {
    await transition(reservation.job.id, "FAILED", input.deviceName, "ENCODING_FAILED");
    throw error;
  }

  await transition(reservation.job.id, "SENDING", input.deviceName);
  try {
    const result = await printer.send({ dataBase64: toBase64(encoded) });
    await transition(reservation.job.id, "SENT", input.deviceName);
    return { jobId: reservation.job.id, bytesWritten: result.bytesWritten };
  } catch {
    // Once transmission starts, the physical result is unknowable. Never retry.
    await transition(reservation.job.id, "UNKNOWN", input.deviceName, "UNKNOWN_TRANSPORT_RESULT");
    throw new Error("A conexão falhou durante o envio. O resultado físico é incerto; confira a impressora antes de solicitar uma reimpressão.");
  }
}
