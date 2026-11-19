import { useEffect, useRef, useState } from "react";
import { classify, type Reading } from "./classify";
import { CONSENSUS_EXPIRE_MS, createConsensus } from "./consensus";
import { provenDecoder, type Decoder } from "./decoder";
import { LimitError, withLimit } from "./limit";

export type ScannerProblem = "no-camera" | "denied" | "decoder-failed";

const FRAME_MS = 120;
const DECODE_LIMIT_MS = 5000;
const MAX_FAILED_DECODES = 10;
const NOT_A_BOOK = "That barcode isn't a book's ISBN. Look for the one starting 978 or 979.";

export function Scanner(props: {
  want: "isbn" | "label";
  onRead: (reading: Reading) => void;
  onProblem: (problem: ScannerProblem) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const consensus = useRef(createConsensus());
  // The barcode behind the on-screen message, and when it was last in view.
  const notBook = useRef<{ value: string; lastSeen: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Switching what is wanted starts over: nothing counted or shown for the old want carries across.
  useEffect(() => {
    consensus.current = createConsensus();
    notBook.current = null;
    setMessage(null);
  }, [props.want]);

  useEffect(() => {
    let session = 0; // changes on every start and stop, so late results from an old one are ignored
    let running = false;
    let finished = false; // unmounted, or a problem was reported
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let decoder: Promise<Decoder> | null = null;

    const stop = () => {
      session++;
      running = false;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    };
    const problem = (p: ScannerProblem) => {
      stop();
      if (finished) return;
      finished = true;
      latest.current.onProblem(p);
    };

    function handle(result: ReturnType<typeof classify>, value: string, now: number) {
      if (!result) return;
      const { want, onRead } = latest.current;
      if (result.kind === "not-a-book-barcode") {
        if (want === "isbn") {
          notBook.current = { value, lastSeen: now };
          setMessage(NOT_A_BOOK);
        }
      } else if (result.kind === want) {
        notBook.current = null;
        setMessage(null);
        onRead(result);
      }
    }

    async function start() {
      if (finished || running) return;
      running = true;
      const mine = ++session;
      consensus.current = createConsensus();

      if (typeof navigator.mediaDevices?.getUserMedia !== "function") return problem("no-camera");

      let got: MediaStream;
      try {
        got = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch (e) {
        if (mine !== session) return;
        const name = (e as DOMException | undefined)?.name;
        return problem(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "no-camera");
      }
      if (mine !== session) {
        got.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = got;

      let ready: Decoder;
      try {
        decoder ??= provenDecoder();
        ready = await decoder;
      } catch {
        if (mine !== session) return;
        return problem("decoder-failed");
      }
      if (mine !== session) return;

      const video = videoRef.current;
      if (!video) return stop();
      video.srcObject = got;
      try {
        await video.play();
      } catch {
        // Autoplay can be refused; frames are skipped until the video has data.
      }
      if (mine !== session) return;

      let rejected = 0;
      const tick = async () => {
        if (mine !== session) return;
        if (video.readyState >= 2) {
          try {
            const found = await withLimit(ready.detect(video), DECODE_LIMIT_MS);
            if (mine !== session) return;
            rejected = 0;
            const now = Date.now();
            // Consensus first, then classify: every raw value counts, only an accepted one is looked at.
            const accepted = consensus.current.feed(found.map((f) => f.rawValue), now);
            if (accepted !== null) {
              const format = found.find((f) => f.rawValue === accepted)?.format ?? "";
              handle(classify(accepted, format), accepted, now);
            }
            const shown = notBook.current;
            if (shown) {
              if (found.some((f) => f.rawValue === shown.value)) shown.lastSeen = now;
              else if (now - shown.lastSeen >= CONSENSUS_EXPIRE_MS) {
                notBook.current = null;
                setMessage(null);
              }
            }
          } catch (e) {
            // A frame that times out is skipped. One that rejects is skipped too, but a decoder
            // that keeps rejecting is broken (e.g. its WebAssembly never loaded).
            if (mine !== session) return;
            if (!(e instanceof LimitError) && ++rejected >= MAX_FAILED_DECODES) return problem("decoder-failed");
          }
        }
        if (mine === session) timer = setTimeout(() => void tick(), FRAME_MS);
      };
      timer = setTimeout(() => void tick(), FRAME_MS);
    }

    // Switching apps or locking the phone hides the page: release the camera, and take it again on return.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stop();
      else void start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void start();

    return () => {
      finished = true;
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, []);

  return (
    <div>
      <video ref={videoRef} playsInline muted style={{ width: "100%" }} />
      {message && <p role="status">{message}</p>}
    </div>
  );
}
