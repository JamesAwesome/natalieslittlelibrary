import { BarcodeDetector as BundledDetector, prepareZXingModule } from "barcode-detector/ponyfill";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import QRCode from "qrcode";
import { withLimit } from "./limit";

export type Decoder = {
  detect(source: CanvasImageSource): Promise<{ rawValue: string; format: string }[]>;
};

const FORMATS = ["ean_13", "upc_a", "qr_code"] as const;
const PROOF_TEXT = "decoder-check";
// A 0.9 MB download on a slow phone.
const PROOF_MS = 15000;

let prepared = false;

// The decoder's WebAssembly is served from this app's own assets, never a CDN.
// Note: this never throws if the WebAssembly fails to load; the ponyfill swallows
// that and every later detect() rejects. Use provenDecoder() to find out.
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

// The bundled decoder, once it has read a QR code drawn here. Rejects if it
// cannot (WebAssembly missing or broken, or no answer within 15 seconds).
export async function provenDecoder(): Promise<Decoder> {
  const decoder = bundledDecoder();
  const canvas = document.createElement("canvas");
  await QRCode.toCanvas(canvas, PROOF_TEXT, { width: 160, margin: 4 });
  const read = await withLimit(decoder.detect(canvas), PROOF_MS);
  if (!read.some((r) => r.rawValue === PROOF_TEXT)) throw new Error("decoder read nothing from its test code");
  return decoder;
}
