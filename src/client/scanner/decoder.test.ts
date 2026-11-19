import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("qrcode", () => ({ default: { toCanvas: vi.fn(async () => undefined) } }));

import { chooseDecoder, nativeDecoder } from "./decoder";

type Read = { rawValue: string; format: string }[];

function installNative(opts: { formats?: string[]; detect?: () => Promise<Read> }) {
  const formats = opts.formats ?? ["ean_13", "upc_a", "qr_code"];
  class FakeDetector {
    static getSupportedFormats = async () => formats;
    detect = opts.detect ?? (async () => []);
  }
  vi.stubGlobal("BarcodeDetector", FakeDetector);
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("nativeDecoder", () => {
  test("is null when the browser has no BarcodeDetector", async () => {
    vi.stubGlobal("BarcodeDetector", undefined);
    expect(await nativeDecoder()).toBeNull();
  });

  test("is null when its formats lack ean_13", async () => {
    installNative({ formats: ["qr_code"], detect: async () => [{ rawValue: "x", format: "qr_code" }] });
    expect(await nativeDecoder()).toBeNull();
  });

  test("is null when its formats lack qr_code", async () => {
    installNative({ formats: ["ean_13"] });
    expect(await nativeDecoder()).toBeNull();
  });

  test("is null when it never answers within 3 seconds", async () => {
    vi.useFakeTimers();
    installNative({ detect: () => new Promise(() => {}) });
    const p = nativeDecoder();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await p).toBeNull();
  });

  test("is null when it throws", async () => {
    installNative({ detect: async () => { throw new Error("boom"); } });
    expect(await nativeDecoder()).toBeNull();
  });

  test("is null when it reads nothing from the test code", async () => {
    installNative({ detect: async () => [] });
    expect(await nativeDecoder()).toBeNull();
  });

  test("is null when it reads the wrong thing from the test code", async () => {
    installNative({ detect: async () => [{ rawValue: "something else", format: "qr_code" }] });
    expect(await nativeDecoder()).toBeNull();
  });

  test("is returned when it reads the test code", async () => {
    installNative({ detect: async () => [{ rawValue: "native-check", format: "qr_code" }] });
    const d = await nativeDecoder();
    expect(d).not.toBeNull();
    expect(await d!.detect(document.createElement("canvas"))).toEqual([{ rawValue: "native-check", format: "qr_code" }]);
  });
});

describe("chooseDecoder", () => {
  test("prefers a proven native decoder", async () => {
    installNative({ detect: async () => [{ rawValue: "native-check", format: "qr_code" }] });
    const d = await chooseDecoder();
    expect(await d.detect(document.createElement("canvas"))).toEqual([{ rawValue: "native-check", format: "qr_code" }]);
  });

  test("falls back to the bundled decoder when the native one is not proven", async () => {
    installNative({ detect: async () => [] });
    const d = await chooseDecoder();
    expect(typeof d.detect).toBe("function");
  });
});
