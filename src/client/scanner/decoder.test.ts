import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type Read = { rawValue: string; format: string }[];
const detect = vi.fn<(source: unknown) => Promise<Read>>();

vi.mock("qrcode", () => ({ default: { toCanvas: vi.fn(async () => undefined) } }));
vi.mock("barcode-detector/ponyfill", () => ({
  prepareZXingModule: vi.fn(),
  BarcodeDetector: class {
    detect = (s: unknown) => detect(s);
  },
}));

import { provenDecoder } from "./decoder";

beforeEach(() => {
  detect.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("provenDecoder", () => {
  test("resolves with a decoder that reads the test code", async () => {
    detect.mockResolvedValue([{ rawValue: "decoder-check", format: "qr_code" }]);
    const d = await provenDecoder();
    expect(await d.detect(document.createElement("canvas"))).toEqual([{ rawValue: "decoder-check", format: "qr_code" }]);
  });

  test("rejects when detect always rejects, as when the WebAssembly failed to load", async () => {
    detect.mockRejectedValue(new Error("NotSupportedError"));
    await expect(provenDecoder()).rejects.toThrow("NotSupportedError");
  });

  test("rejects when it reads nothing from the test code", async () => {
    detect.mockResolvedValue([]);
    await expect(provenDecoder()).rejects.toThrow();
  });

  test("rejects when it reads the wrong thing", async () => {
    detect.mockResolvedValue([{ rawValue: "other", format: "qr_code" }]);
    await expect(provenDecoder()).rejects.toThrow();
  });

  test("rejects when it does not answer within 15 seconds, and not before", async () => {
    vi.useFakeTimers();
    detect.mockImplementation(() => new Promise(() => {}));
    let outcome = "pending";
    const p = provenDecoder().then(() => (outcome = "ok"), () => (outcome = "failed"));
    await vi.advanceTimersByTimeAsync(14900);
    expect(outcome).toBe("pending");
    await vi.advanceTimersByTimeAsync(200);
    await p;
    expect(outcome).toBe("failed");
  });
});
