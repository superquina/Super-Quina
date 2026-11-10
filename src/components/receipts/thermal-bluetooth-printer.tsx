"use client";

import { useEffect, useState } from "react";
import { getSuperQuinaPrinter, type PairedPrinter } from "@/modules/printing/client/superquina-printer-bridge";
import { printOfficialPurchaseReceipt } from "@/modules/printing/client/print-official-purchase-receipt";
import type { EscPosProfile } from "@/modules/printing/escpos/encode-thermal-receipt";

type PaperPreset = "58-a" | "58-b" | "80-a" | "80-b" | "custom";
const PROFILE_PRESETS: Record<Exclude<PaperPreset, "custom">, EscPosProfile> = {
  "58-a": { paperWidthMm: 58, columns: 32, fontMode: "A", copies: 1, feedLines: 3, qrCode: true, unsupportedCharacter: "transliterate" },
  "58-b": { paperWidthMm: 58, columns: 42, fontMode: "B", copies: 1, feedLines: 3, qrCode: true, unsupportedCharacter: "transliterate" },
  "80-a": { paperWidthMm: 80, columns: 48, fontMode: "A", copies: 1, feedLines: 3, qrCode: true, unsupportedCharacter: "transliterate" },
  "80-b": { paperWidthMm: 80, columns: 64, fontMode: "B", copies: 1, feedLines: 3, qrCode: true, unsupportedCharacter: "transliterate" },
};
const PROFILE_STORAGE_KEY = "superquina-printer-profile-v2";

export function ThermalBluetoothPrinter({ purchaseId }: { purchaseId?: string }) {
  const [devices, setDevices] = useState<PairedPrinter[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [connectedId, setConnectedId] = useState("");
  const [connectedName, setConnectedName] = useState("");
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [paperPreset, setPaperPreset] = useState<PaperPreset>("58-a");
  const [customWidth, setCustomWidth] = useState<58 | 80>(58);
  const [customColumns, setCustomColumns] = useState(32);
  const [customFontMode, setCustomFontMode] = useState<"A" | "B">("A");

  function loadPaperProfile(printerId: string) {
    let parsed: { preset?: PaperPreset; width?: 58 | 80; columns?: number; fontMode?: "A" | "B" } = {};
    try {
      const saved = localStorage.getItem(PROFILE_STORAGE_KEY + ":" + printerId);
      if (saved) parsed = JSON.parse(saved) as typeof parsed;
    } catch {
      // Invalid or unavailable local settings fall back to the safe default profile.
    }
    setPaperPreset(parsed.preset && ["58-a", "58-b", "80-a", "80-b", "custom"].includes(parsed.preset) ? parsed.preset : "58-a");
    setCustomWidth(parsed.width === 80 ? 80 : 58);
    setCustomColumns(Number.isInteger(parsed.columns) && parsed.columns! >= 16 && parsed.columns! <= 96 ? parsed.columns! : 32);
    setCustomFontMode(parsed.fontMode === "B" ? "B" : "A");
  }

  const selectedProfile: EscPosProfile = paperPreset === "custom"
    ? { paperWidthMm: customWidth, columns: customColumns, fontMode: customFontMode, copies: 1, feedLines: 3, qrCode: true, unsupportedCharacter: "transliterate" }
    : PROFILE_PRESETS[paperPreset];

  function savePaperProfile(preset: PaperPreset, width = customWidth, columns = customColumns, fontMode = customFontMode) {
    setPaperPreset(preset);
    if (!selectedId) return;
    try {
      localStorage.setItem(`${PROFILE_STORAGE_KEY}:${selectedId}`, JSON.stringify({ preset, width, columns, fontMode }));
    } catch { /* Settings remain usable for this session. */ }
  }

  async function refreshDevices() {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const printer = getSuperQuinaPrinter();
      const [result, state] = await Promise.all([
        printer.listPairedDevices(),
        printer.getConnectionState(),
      ]);
      setDevices(result.devices);
      const nextSelectedId =
        selectedId && result.devices.some((device) => device.id === selectedId)
          ? selectedId
          : state.connected && result.devices.some((device) => device.id === state.deviceId)
            ? state.deviceId!
            : result.devices[0]?.id ?? "";
      setSelectedId(nextSelectedId);
      if (nextSelectedId) loadPaperProfile(nextSelectedId);
      setConnectedId(state.connected ? state.deviceId ?? "" : "");
      setConnectedName(state.connected ? state.name ?? "" : "");
      if (result.devices.length === 0) {
        setNotice("Nenhuma impressora pareada. Pareie a impressora nas configurações Bluetooth do Android e atualize a lista.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível localizar impressoras Bluetooth.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) return refreshDevices();
      return undefined;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function openBluetoothPairing() {
    setError("");
    setNotice("");
    try {
      await getSuperQuinaPrinter().openBluetoothSettings();
      setNotice("Configurações Bluetooth abertas. Emparelhe a impressora e volte aqui para atualizar a lista.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível abrir o emparelhamento Bluetooth.");
    }
  }

  async function connectPrinter() {
    if (!selectedId) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const result = await getSuperQuinaPrinter().connect({ deviceId: selectedId });
      setConnectedId(result.deviceId);
      setConnectedName(result.name);
      setNotice(`Conectado a ${result.name}. A impressora está pronta para receber o recibo.`);
    } catch (reason) {
      setConnectedId("");
      setConnectedName("");
      setError(reason instanceof Error ? reason.message : "Não foi possível conectar à impressora.");
    } finally {
      setLoading(false);
    }
  }

  async function disconnectPrinter() {
    setLoading(true);
    setError("");
    try {
      await getSuperQuinaPrinter().disconnect();
      setConnectedId("");
      setConnectedName("");
      setNotice("Impressora desconectada.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível desconectar.");
    } finally {
      setLoading(false);
    }
  }

  async function printTestPage() {
    if (!connectedId || connectedId !== selectedId || printing) return;
    setPrinting(true);
    setError("");
    setNotice("");
    try {
      const testBytes = new Uint8Array([
        0x1b, 0x40, 0x1b, 0x4d, selectedProfile.fontMode === "B" ? 0x01 : 0x00,
        0x1b, 0x61, 0x01, 0x1b, 0x45, 0x01,
        ...Array.from("SUPER QUINA", (char) => char.charCodeAt(0)), 0x0a,
        0x1b, 0x45, 0x00,
        ...Array.from("TESTE DE IMPRESSAO", (char) => char.charCodeAt(0)), 0x0a,
        ...Array.from(`PAPEL ${selectedProfile.paperWidthMm} MM - ${selectedProfile.columns} COLUNAS`, (char) => char.charCodeAt(0)), 0x0a,
        ...Array.from("-".repeat(selectedProfile.columns), (char) => char.charCodeAt(0)), 0x0a,
        ...Array.from("ESTE TESTE NAO E UM RECIBO", (char) => char.charCodeAt(0)), 0x0a,
        0x0a, 0x0a, 0x0a,
      ]);
      let binary = "";
      for (const byte of testBytes) binary += String.fromCharCode(byte);
      const result = await getSuperQuinaPrinter().send({ dataBase64: btoa(binary) });
      setNotice(`Teste enviado (${result.bytesWritten} bytes). Confira a largura e a legibilidade no papel. O Android não confirma a saída física.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar a página de teste.");
    } finally {
      setPrinting(false);
    }
  }

  async function printReceipt() {
    if (!purchaseId) return;
    const device = devices.find((item) => item.id === connectedId);
    if (!device || printing) return;
    setPrinting(true);
    setError("");
    setNotice("");
    try {
      const result = await printOfficialPurchaseReceipt({
        purchaseId,
        deviceId: device.id,
        deviceName: device.name,
        profile: selectedProfile,
      });
      setNotice(`Dados enviados à impressora (${result.bytesWritten} bytes). Confira se o recibo saiu corretamente. O Android não confirma a saída física do papel.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar o recibo.");
    } finally {
      setPrinting(false);
    }
  }

  return (
    <section className="thermal-bluetooth-printer" aria-label="Configuração da impressora térmica">
      <h3>Impressora térmica Bluetooth</h3>
      <p>1. Toque em Emparelhar impressora e escolha a impressora nas configurações Bluetooth do Android. 2. Volte ao aplicativo e atualize a lista. 3. Selecione e conecte a impressora antes de imprimir.</p>
      <div className="thermal-printer-controls">
        <label htmlFor="superquina-paper-profile">Largura e perfil do papel</label>
        <select id="superquina-paper-profile" value={paperPreset} onChange={(event) => savePaperProfile(event.target.value as PaperPreset)}>
          <option value="58-a">Bobina 58 mm — fonte A (32 colunas)</option>
          <option value="58-b">Bobina 58 mm — fonte B (42 colunas)</option>
          <option value="80-a">Bobina 80 mm — fonte A (48 colunas)</option>
          <option value="80-b">Bobina 80 mm — fonte B (64 colunas)</option>
          <option value="custom">Personalizar largura e colunas</option>
        </select>
        {paperPreset === "custom" && <div className="thermal-printer-custom-profile">
          <label htmlFor="superquina-paper-width">Largura da bobina</label>
          <select id="superquina-paper-width" value={customWidth} onChange={(event) => { const width = Number(event.target.value) as 58 | 80; setCustomWidth(width); savePaperProfile("custom", width, customColumns); }}>
            <option value={58}>58 mm</option><option value={80}>80 mm</option>
          </select>
          <label htmlFor="superquina-paper-columns">Colunas de impressão</label>
          <input id="superquina-paper-columns" type="number" min={16} max={96} value={customColumns} onChange={(event) => { const columns = Math.max(16, Math.min(96, Number(event.target.value) || 16)); setCustomColumns(columns); savePaperProfile("custom", customWidth, columns); }} />
          <label htmlFor="superquina-paper-font">Fonte ESC/POS</label>
          <select id="superquina-paper-font" value={customFontMode} onChange={(event) => { const fontMode = event.target.value as "A" | "B"; setCustomFontMode(fontMode); savePaperProfile("custom", customWidth, customColumns, fontMode); }}>
            <option value="A">Fonte A (mais larga)</option><option value="B">Fonte B (mais estreita)</option>
          </select>
        </div>}
        <label htmlFor="superquina-printer-select">Impressora pareada</label>
        <select
          id="superquina-printer-select"
          value={selectedId}
          onChange={(event) => {
            const printerId = event.target.value;
            setSelectedId(printerId);
            if (printerId) loadPaperProfile(printerId);
            setNotice("");
            setError("");
          }}
          disabled={loading || devices.length === 0}
        >
          {devices.length === 0 ? <option value="">Nenhuma impressora encontrada</option> : null}
          {devices.map((device) => (
            <option key={device.id} value={device.id}>{device.name}</option>
          ))}
        </select>
        <div className="thermal-printer-actions">
          <button type="button" onClick={() => void openBluetoothPairing()} disabled={loading || printing}>
            Emparelhar impressora
          </button>
          <button type="button" onClick={() => void refreshDevices()} disabled={loading || printing}>
            {loading ? "Aguarde…" : "Atualizar lista"}
          </button>
          {connectedId === selectedId && connectedId ? (
            <button type="button" onClick={() => void disconnectPrinter()} disabled={loading || printing}>Desconectar</button>
          ) : (
            <button type="button" onClick={() => void connectPrinter()} disabled={loading || !selectedId || printing}>Conectar</button>
          )}
          <button type="button" onClick={() => void printTestPage()} disabled={!connectedId || connectedId !== selectedId || printing || loading}>
            {printing ? "Enviando…" : "Imprimir teste"}
          </button>
          {purchaseId ? <button type="button" onClick={() => void printReceipt()} disabled={!connectedId || connectedId !== selectedId || printing || loading}>
            {printing ? "Enviando…" : "Imprimir recibo"}
          </button> : null}
        </div>
      </div>
      <p role="status">{connectedId ? `Conectada: ${connectedName}` : "Nenhuma impressora conectada."}</p>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      <small>O envio Bluetooth não comprova que o papel foi impresso. Confira o resultado antes de solicitar uma reimpressão.</small>
    </section>
  );
}
