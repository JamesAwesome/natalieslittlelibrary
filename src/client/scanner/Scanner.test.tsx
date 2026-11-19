import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type Read = { rawValue: string; format: string }[];
const detect = vi.fn<(source: CanvasImageSource) => Promise<Read>>();
const chooseDecoder = vi.fn(async () => ({ detect }));

vi.mock("./decoder", () => ({ chooseDecoder: () => chooseDecoder() }));

import { Scanner } from "./index";

const ISBN = "9780306406157";
const NON_BOOK = "0794972486008";
const NOT_BOOK_MESSAGE = "That barcode isn't a book's ISBN. Look for the one starting 978 or 979.";

const stopTrack = vi.fn();
function fakeStream() {
  return { getTracks: () => [{ stop: stopTrack }, { stop: stopTrack }] } as unknown as MediaStream;
}

function setMedia(getUserMedia: unknown) {
  Object.defineProperty(navigator, "mediaDevices", { value: getUserMedia === undefined ? undefined : { getUserMedia }, configurable: true });
}

async function tick(ms = 120) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// Lets the camera and decoder come up, then feeds one frame per entry.
async function runFrames(frames: Read[]) {
  for (const f of frames) detect.mockResolvedValueOnce(f);
  detect.mockResolvedValue([]);
  for (let i = 0; i < frames.length; i++) await tick();
}

const frame = (...values: string[]): Read =>
  values.map((v) => ({ rawValue: v, format: v.length === 13 ? "ean_13" : "qr_code" }));

beforeEach(() => {
  vi.useFakeTimers();
  detect.mockReset();
  chooseDecoder.mockClear();
  chooseDecoder.mockImplementation(async () => ({ detect }));
  stopTrack.mockReset();
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", { get: () => 4, configurable: true });
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
  setMedia(vi.fn(async () => fakeStream()));
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(HTMLMediaElement.prototype, "readyState");
});

describe("Scanner problems", () => {
  test("no camera API reports no-camera once", async () => {
    setMedia(undefined);
    const onProblem = vi.fn();
    render(<Scanner want="isbn" onRead={vi.fn()} onProblem={onProblem} />);
    await tick();
    expect(onProblem).toHaveBeenCalledExactlyOnceWith("no-camera");
  });

  test("a refused permission reports denied once", async () => {
    setMedia(vi.fn(async () => { throw new DOMException("no", "NotAllowedError"); }));
    const onProblem = vi.fn();
    render(<Scanner want="isbn" onRead={vi.fn()} onProblem={onProblem} />);
    await tick();
    expect(onProblem).toHaveBeenCalledExactlyOnceWith("denied");
  });

  test("a decoder that cannot be created reports decoder-failed and releases the camera", async () => {
    chooseDecoder.mockRejectedValue(new Error("wasm"));
    const onProblem = vi.fn();
    render(<Scanner want="isbn" onRead={vi.fn()} onProblem={onProblem} />);
    await tick();
    expect(onProblem).toHaveBeenCalledExactlyOnceWith("decoder-failed");
    expect(stopTrack).toHaveBeenCalledTimes(2);
  });

  test("asks for the rear camera and shows an inline, muted video", async () => {
    const gum = vi.fn(async () => fakeStream());
    setMedia(gum);
    const { container } = render(<Scanner want="isbn" onRead={vi.fn()} onProblem={vi.fn()} />);
    await tick();
    expect(gum).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ facingMode: { ideal: "environment" } }) }));
    const video = container.querySelector("video")!;
    expect(video.muted).toBe(true);
    expect(video).toHaveAttribute("playsinline");
  });
});

describe("Scanner reading", () => {
  test("the same ISBN in three frames gives one onRead, and not a second while it stays", async () => {
    const onRead = vi.fn();
    render(<Scanner want="isbn" onRead={onRead} onProblem={vi.fn()} />);
    await tick(0);
    await runFrames([frame(ISBN), frame(ISBN), frame(ISBN), frame(ISBN), frame(ISBN)]);
    expect(onRead).toHaveBeenCalledExactlyOnceWith({ kind: "isbn", isbn: ISBN });
  });

  test("two frames of an ISBN are not enough", async () => {
    const onRead = vi.fn();
    render(<Scanner want="isbn" onRead={onRead} onProblem={vi.fn()} />);
    await tick(0);
    await runFrames([frame(ISBN), frame(ISBN)]);
    expect(onRead).not.toHaveBeenCalled();
  });

  test("a label QR in three frames is read when wanting a label", async () => {
    const onRead = vi.fn();
    render(<Scanner want="label" onRead={onRead} onProblem={vi.fn()} />);
    await tick(0);
    const qr = "https://books.example.test/b/t2xak7q2xz";
    await runFrames([frame(qr), frame(qr), frame(qr)]);
    expect(onRead).toHaveBeenCalledExactlyOnceWith({ kind: "label", code: "t2xak7q2xz" });
  });

  test("an ISBN accepted while wanting a label is not passed on", async () => {
    const onRead = vi.fn();
    render(<Scanner want="label" onRead={onRead} onProblem={vi.fn()} />);
    await tick(0);
    await runFrames([frame(ISBN), frame(ISBN), frame(ISBN)]);
    expect(onRead).not.toHaveBeenCalled();
    expect(screen.queryByText(NOT_BOOK_MESSAGE)).toBeNull();
  });

  test("a non-book barcode in three frames shows the message and does not call onRead", async () => {
    const onRead = vi.fn();
    render(<Scanner want="isbn" onRead={onRead} onProblem={vi.fn()} />);
    await tick(0);
    await runFrames([frame(NON_BOOK), frame(NON_BOOK), frame(NON_BOOK)]);
    expect(screen.getByText(NOT_BOOK_MESSAGE)).toBeInTheDocument();
    expect(onRead).not.toHaveBeenCalled();
  });

  test("the same barcode in a single frame shows nothing", async () => {
    render(<Scanner want="isbn" onRead={vi.fn()} onProblem={vi.fn()} />);
    await tick(0);
    await runFrames([frame(NON_BOOK), frame(), frame()]);
    expect(screen.queryByText(NOT_BOOK_MESSAGE)).toBeNull();
  });

  test("non-book misreads between two readings of an ISBN reset the count", async () => {
    const onRead = vi.fn();
    render(<Scanner want="isbn" onRead={onRead} onProblem={vi.fn()} />);
    await tick(0);
    await runFrames([frame(ISBN), frame(ISBN), frame(NON_BOOK), frame(ISBN)]);
    expect(onRead).not.toHaveBeenCalled();
    expect(screen.queryByText(NOT_BOOK_MESSAGE)).toBeNull();
  });

  test("a frame with a label QR and a barcode both in view reads each once", async () => {
    const onRead = vi.fn();
    const qr = "https://books.example.test/b/t2xak7q2xz";
    render(<Scanner want="label" onRead={onRead} onProblem={vi.fn()} />);
    await tick(0);
    await runFrames([frame(qr, ISBN), frame(qr, ISBN), frame(qr, ISBN), frame(qr, ISBN)]);
    expect(onRead).toHaveBeenCalledExactlyOnceWith({ kind: "label", code: "t2xak7q2xz" });
  });

  test("a frame that errors is skipped without resetting the count", async () => {
    const onRead = vi.fn();
    render(<Scanner want="isbn" onRead={onRead} onProblem={vi.fn()} />);
    await tick(0);
    detect.mockResolvedValueOnce(frame(ISBN)).mockResolvedValueOnce(frame(ISBN)).mockRejectedValueOnce(new Error("bad frame")).mockResolvedValueOnce(frame(ISBN));
    detect.mockResolvedValue([]);
    for (let i = 0; i < 4; i++) await tick();
    expect(onRead).toHaveBeenCalledExactlyOnceWith({ kind: "isbn", isbn: ISBN });
  });

  test("a decode call that never answers is abandoned after 5 seconds and scanning resumes", async () => {
    const onRead = vi.fn();
    render(<Scanner want="isbn" onRead={onRead} onProblem={vi.fn()} />);
    await tick(0);
    detect.mockImplementationOnce(() => new Promise(() => {}));
    await tick(120);
    await tick(5000);
    for (const f of [frame(ISBN), frame(ISBN), frame(ISBN)]) detect.mockResolvedValueOnce(f);
    detect.mockResolvedValue([]);
    for (let i = 0; i < 4; i++) await tick();
    expect(onRead).toHaveBeenCalledOnce();
  });
});

describe("Scanner camera lifetime", () => {
  test("unmounting stops every track and the scanning", async () => {
    const { unmount } = render(<Scanner want="isbn" onRead={vi.fn()} onProblem={vi.fn()} />);
    await tick();
    expect(stopTrack).not.toHaveBeenCalled();
    unmount();
    expect(stopTrack).toHaveBeenCalledTimes(2);
    detect.mockClear();
    await tick(1000);
    expect(detect).not.toHaveBeenCalled();
  });

  test("hiding the page stops every track", async () => {
    render(<Scanner want="isbn" onRead={vi.fn()} onProblem={vi.fn()} />);
    await tick();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(stopTrack).toHaveBeenCalledTimes(2);
    Reflect.deleteProperty(document, "visibilityState");
  });

  test("unmounting before the camera answers still releases it", async () => {
    let give: (s: MediaStream) => void = () => {};
    setMedia(vi.fn(() => new Promise<MediaStream>((r) => { give = r; })));
    const { unmount } = render(<Scanner want="isbn" onRead={vi.fn()} onProblem={vi.fn()} />);
    unmount();
    await act(async () => { give(fakeStream()); });
    expect(stopTrack).toHaveBeenCalledTimes(2);
  });
});
