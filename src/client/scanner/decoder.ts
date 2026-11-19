import { BarcodeDetector as BundledDetector, prepareZXingModule } from "barcode-detector/ponyfill";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import QRCode from "qrcode";

export type Decoder = {
  detect(source: CanvasImageSource): Promise<{ rawValue: string; format: string }[]>;
};

const FORMATS = ["ean_13", "upc_a", "qr_code"] as const;
const PROOF_TEXT = "native-check";
const PROOF_MS = 3000;

type NativeCtor = {
  new (options: { formats: string[] }): Decoder;
  getSupportedFormats(): Promise<string[]>;
};

let prepared = false;

// The decoder's WebAssembly is served from this app's own assets, never a CDN.
export function bundledDecoder(): Decoder {
  if (!prepared) {
    prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path),
      },
    });
    prepared = true;
  }
  const detector = new BundledDetector({ formats: [...FORMATS] });
  return { detect: (source) => detector.detect(source) };
}

function withLimit<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

// The browser's own decoder, but only if it reads both kinds of code and
// proves it by reading a QR code drawn here.
export async function nativeDecoder(): Promise<Decoder | null> {
  const Native = (globalThis as unknown as { BarcodeDetector?: NativeCtor }).BarcodeDetector;
  if (!Native) return null;
  try {
    const supported = await Native.getSupportedFormats();
    if (!supported.includes("ean_13") || !supported.includes("qr_code")) return null;
    const decoder = new Native({ formats: FORMATS.filter((f) => supported.includes(f)) });
    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, PROOF_TEXT, { width: 160, margin: 4 });
    const read = await withLimit(decoder.detect(canvas), PROOF_MS);
    return read.some((r) => r.rawValue === PROOF_TEXT) ? decoder : null;
  } catch {
    return null;
  }
}

export async function chooseDecoder(): Promise<Decoder> {
  return (await nativeDecoder()) ?? bundledDecoder();
}
