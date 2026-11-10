import { registerPlugin } from "@capacitor/core";
import type { SuperQuinaPrinterPlugin } from "./definitions";

export * from "./definitions";

export const SuperQuinaPrinter = registerPlugin<SuperQuinaPrinterPlugin>("SuperQuinaPrinter");
