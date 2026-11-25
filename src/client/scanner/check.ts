// Dev-only page script for check.html.
import QRCode from "qrcode";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { bundledDecoder } from "./decoder";
import { Scanner } from "./Scanner";

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

function drawEan13(canvas: HTMLCanvasElement, digits: string) {
  const parity = PARITY[Number(digits[0])];
  let bits = "101";
  for (let i = 0; i < 6; i++) bits += (parity[i] === "L" ? L : G)[Number(digits[i + 1])];
  bits += "01010";
  for (let i = 7; i < 13; i++) bits += R[Number(digits[i])];
  bits += "101";
  const unit = 3, quiet = 12 * unit, height = 100;
  canvas.width = bits.length * unit + quiet * 2;
  canvas.height = height + 40;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  [...bits].forEach((b, i) => { if (b === "1") ctx.fillRect(quiet + i * unit, 20, unit, height); });
}

// ?scanner=1 mounts the real Scanner (use with a fake camera) and records what it reports.
if (new URLSearchParams(location.search).has("scanner")) {
  const result = document.getElementById("result")!;
  result.textContent = "RESULT scanner running";
  createRoot(document.body.appendChild(document.createElement("div"))).render(
    createElement(Scanner, {
      want: "isbn",
      onRead: (r) => { result.textContent = "RESULT read " + JSON.stringify(r); },
      onProblem: (p) => { result.textContent = "RESULT problem " + p; },
    }),
  );
  await new Promise(() => {});
}

const qrText = "https://books.example.test/b/t2xak7q2xz";
const isbn = "9780306406157";
const qr = document.getElementById("qr") as HTMLCanvasElement;
const ean = document.getElementById("ean") as HTMLCanvasElement;
await QRCode.toCanvas(qr, qrText, { width: 240, margin: 4 });
drawEan13(ean, isbn);

const decoder = bundledDecoder();
const out: Record<string, unknown> = {};
for (const [name, canvas, want] of [["qr", qr, qrText], ["ean", ean, isbn]] as const) {
  const t0 = performance.now();
  try {
    const got = await decoder.detect(canvas);
    out[name] = { ok: got.some((g) => g.rawValue === want), got, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    out[name] = { ok: false, error: String(e) };
  }
}
document.getElementById("result")!.textContent = "RESULT " + JSON.stringify(out);
