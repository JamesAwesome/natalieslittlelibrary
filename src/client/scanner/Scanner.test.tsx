import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type Read = { rawValue: string; format: string }[];
const detect = vi.fn<(source: CanvasImageSource) => Promise<Read>>();
const provenDecoder = vi.fn(async () => ({ detect }));

vi.mock("./decoder", () => ({ provenDecoder: () => provenDecoder() }));

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
  provenDecoder.mockClear();
  provenDecoder.mockImplementation(async () => ({ detect }));
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

  test.each(["NotAllowedError", "SecurityError"])("%s reports denied", async (name) => {
    setMedia(vi.fn(async () => { throw new DOMException("no", name); }));
    const onProblem = vi.fn();
    render(<Scanner want="isbn" onRead={vi.fn()} onProblem={onProblem} />);
    await tick();
    expect(onProblem).toHaveBeenCalledExactlyOnceWith("denied");
  });

  test.each(["NotFoundError", "NotReadableError", "AbortError", "OverconstrainedError", "TypeError"])(
    "%s reports no-camera",
    async (name) => {
      setMedia(vi.fn(async () => { throw new DOMException("no", name); }));
      const onProblem = vi.fn();
      render(<Scanner want="isbn" onRead={vi.fn()} onProblem={onProblem} />);
      await tick();
      expect(onProblem).toHaveBeenCalledExactlyOnceWith("no-camera");
    },
  );

  test("a decoder that cannot be created reports decoder-failed and releases the camera", async () => {
    provenDecoder.mockRejectedValue(new Error("wasm"));
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

  test("unmounting before the camera answers still releases it", async () => {
    let give: (s: MediaStream) => void = () => {};
    setMedia(vi.fn(() => new Promise<MediaStream>((r) => { give = r; })));
    const { unmount } = render(<Scanner want="isbn" onRead={vi.fn()} onProblem={vi.fn()} />);
    unmount();
    await act(async () => { give(fakeStream()); });
    expect(stopTrack).toHaveBeenCalledTimes(2);
  });

  function setVisibility(state: "hidden" | "visible") {
    Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  }

  test("hiding stops the camera; showing again takes it again and readings flow", async () => {
    const streams: { stop: ReturnType<typeof vi.fn> }[] = [];
    const gum = vi.fn(async () => {
      const stop = vi.fn();
      streams.push({ stop });
      return { getTracks: () => [{ stop }] } as unknown as MediaStream;
    });
    setMedia(gum);
    const onRead = vi.fn();
    render(<Scanner want="isbn" onRead={onRead} onProblem={vi.fn()} />);
    await tick();
    setVisibility("hidden");
    expect(streams[0].stop).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    await tick(0);
    expect(gum).toHaveBeenCalledTimes(2);
    await runFrames([frame(ISBN), frame(ISBN), frame(ISBN)]);
    expect(onRead).toHaveBeenCalledExactlyOnceWith({ kind: "isbn", isbn: ISBN });
    Reflect.deleteProperty(document, "visibilityState");
  });

  test("the count starts fresh after the page comes back", async () => {
    const onRead = vi.fn();
    render(<Scanner want="isbn" onRead={onRead} onProblem={vi.fn()} />);
    await tick(0);
    await runFrames([frame(ISBN), frame(ISBN)]);
    setVisibility("hidden");
    setVisibility("visible");
    await tick(0);
    await runFrames([frame(ISBN)]);
    expect(onRead).not.toHaveBeenCalled();
    Reflect.deleteProperty(document, "visibilityState");
  });

  test("a hide while the camera is still being asked for leaves nothing dead and nothing leaked", async () => {
    const resolvers: ((s: MediaStream) => void)[] = [];
    const stops: ReturnType<typeof vi.fn>[] = [];
    const gum = vi.fn(() => new Promise<MediaStream>((r) => { resolvers.push(r); }));
    setMedia(gum);
    const onRead = vi.fn();
    render(<Scanner want="isbn" onRead={onRead} onProblem={vi.fn()} />);
    setVisibility("hidden");
    setVisibility("visible");
    expect(gum).toHaveBeenCalledTimes(2);
    for (const r of resolvers) {
      const stop = vi.fn();
      stops.push(stop);
      await act(async () => { r({ getTracks: () => [{ stop }] } as unknown as MediaStream); });
    }
    expect(stops[0]).toHaveBeenCalledTimes(1); // the stream that arrived after the hide is released
    expect(stops[1]).not.toHaveBeenCalled(); // the current one is live
    await runFrames([frame(ISBN), frame(ISBN), frame(ISBN)]);
    expect(onRead).toHaveBeenCalledOnce();
    Reflect.deleteProperty(document, "visibilityState");
  });

  test("a decoder whose detect always rejects raises decoder-failed on the tenth failure, not before", async () => {
    const onProblem = vi.fn();
    render(<Scanner want="isbn" onRead={vi.fn()} onProblem={onProblem} />);
    await tick(0);
    detect.mockRejectedValue(new Error("NotSupportedError"));
    for (let i = 0; i < 9; i++) await tick();
    expect(onProblem).not.toHaveBeenCalled();
    await tick();
    expect(onProblem).toHaveBeenCalledExactlyOnceWith("decoder-failed");
    expect(stopTrack).toHaveBeenCalledTimes(2);
    const calls = detect.mock.calls.length;
    await tick(1000);
    expect(detect.mock.calls.length).toBe(calls);
  });

  test("a good frame between failures restarts the failure count", async () => {
    const onProblem = vi.fn();
    render(<Scanner want="isbn" onRead={vi.fn()} onProblem={onProblem} />);
    await tick(0);
    for (let round = 0; round < 3; round++) {
      detect.mockRejectedValueOnce(new Error("x"));
      for (let i = 0; i < 8; i++) detect.mockRejectedValueOnce(new Error("x"));
      detect.mockResolvedValueOnce([]);
      for (let i = 0; i < 10; i++) await tick();
    }
    expect(onProblem).not.toHaveBeenCalled();
  });

  test("timeouts do not count as failed decodes", async () => {
    const onProblem = vi.fn();
    render(<Scanner want="isbn" onRead={vi.fn()} onProblem={onProblem} />);
    await tick(0);
    detect.mockImplementation(() => new Promise(() => {}));
    for (let i = 0; i < 12; i++) await tick(5200);
    expect(onProblem).not.toHaveBeenCalled();
  });

  test("a non-label QR value between two sightings of an ISBN resets its run", async () => {
    const onRead = vi.fn();
    render(<Scanner want="isbn" onRead={onRead} onProblem={vi.fn()} />);
    await tick(0);
    const other = "https://elsewhere.example.test/page";
    await runFrames([frame(ISBN), frame(ISBN), frame(other), frame(ISBN), frame(ISBN)]);
    expect(onRead).not.toHaveBeenCalled();
    await runFrames([frame(ISBN)]);
    expect(onRead).toHaveBeenCalledOnce();
  });
});

describe("Scanner want changes", () => {
  test("an ISBN accepted while wanting a label is read after switching to an ISBN, once fresh frames agree", async () => {
    const onRead = vi.fn();
    const { rerender } = render(<Scanner want="label" onRead={onRead} onProblem={vi.fn()} />);
    await tick(0);
    await runFrames([frame(ISBN), frame(ISBN), frame(ISBN)]);
    expect(onRead).not.toHaveBeenCalled();
    rerender(<Scanner want="isbn" onRead={onRead} onProblem={vi.fn()} />);
    await runFrames([frame(ISBN), frame(ISBN), frame(ISBN)]);
    expect(onRead).toHaveBeenCalledExactlyOnceWith({ kind: "isbn", isbn: ISBN });
  });

  test("the not-a-book message is cleared when want changes", async () => {
    const { rerender } = render(<Scanner want="isbn" onRead={vi.fn()} onProblem={vi.fn()} />);
    await tick(0);
    await runFrames([frame(NON_BOOK), frame(NON_BOOK), frame(NON_BOOK)]);
    expect(screen.getByText(NOT_BOOK_MESSAGE)).toBeInTheDocument();
    rerender(<Scanner want="label" onRead={vi.fn()} onProblem={vi.fn()} />);
    expect(screen.queryByText(NOT_BOOK_MESSAGE)).toBeNull();
  });

  test("the message goes once that barcode has been out of view for 1.5 s, and stays while it is in view", async () => {
    render(<Scanner want="isbn" onRead={vi.fn()} onProblem={vi.fn()} />);
    await tick(0);
    await runFrames([frame(NON_BOOK), frame(NON_BOOK), frame(NON_BOOK)]);
    for (let i = 0; i < 20; i++) { detect.mockResolvedValueOnce(frame(NON_BOOK)); await tick(); }
    expect(screen.getByText(NOT_BOOK_MESSAGE)).toBeInTheDocument();
    detect.mockResolvedValue([]);
    await tick(1000);
    expect(screen.getByText(NOT_BOOK_MESSAGE)).toBeInTheDocument();
    await tick(700);
    expect(screen.queryByText(NOT_BOOK_MESSAGE)).toBeNull();
  });
});
