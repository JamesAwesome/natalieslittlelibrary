import { useEffect, useRef, useState } from "react";
import { classify, type Reading } from "./classify";
import { createConsensus } from "./consensus";
import { chooseDecoder } from "./decoder";

export type ScannerProblem = "no-camera" | "denied" | "decoder-failed";

const FRAME_MS = 120;
const DECODE_LIMIT_MS = 5000;
const NOT_A_BOOK = "That barcode isn't a book's ISBN. Look for the one starting 978 or 979.";

function withLimit<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("decode timed out")), ms);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

export function Scanner(props: {
  want: "isbn" | "label";
  onRead: (reading: Reading) => void;
  onProblem: (problem: ScannerProblem) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reported = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const stop = () => {
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    };
    const problem = (p: ScannerProblem) => {
      stop();
      if (reported || cancelled) return;
      reported = true;
      latest.current.onProblem(p);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        cancelled = true;
        stop();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    void (async () => {
      if (typeof navigator.mediaDevices?.getUserMedia !== "function") return problem("no-camera");

      let got: MediaStream;
      try {
        got = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch (e) {
        return problem((e as DOMException)?.name === "NotFoundError" ? "no-camera" : "denied");
      }
      stream = got;
      if (cancelled) return stop();

      let decoder: Awaited<ReturnType<typeof chooseDecoder>>;
      try {
        decoder = await chooseDecoder();
      } catch {
        return problem("decoder-failed");
      }
      if (cancelled) return stop();

      const video = videoRef.current;
      if (!video) return stop();
      video.srcObject = got;
      try {
        await video.play();
      } catch {
        // Autoplay can be refused; frames are skipped until the video has data.
      }

      const consensus = createConsensus();
      const tick = async () => {
        if (cancelled) return;
        if (video.readyState >= 2) {
          try {
            const found = await withLimit(decoder.detect(video), DECODE_LIMIT_MS);
            if (cancelled) return;
            // Consensus first, then classify: only an accepted value is looked at.
            const accepted = consensus.feed(found.map((f) => f.rawValue), Date.now());
            if (accepted !== null) {
              const format = found.find((f) => f.rawValue === accepted)?.format ?? "";
              handle(classify(accepted, format));
            }
          } catch {
            // A frame that errors or times out is skipped.
          }
        }
        if (!cancelled) timer = setTimeout(() => void tick(), FRAME_MS);
      };
      timer = setTimeout(() => void tick(), FRAME_MS);
    })();

    function handle(result: ReturnType<typeof classify>) {
      if (!result) return;
      const { want, onRead } = latest.current;
      if (result.kind === "not-a-book-barcode") {
        if (want === "isbn") setMessage(NOT_A_BOOK);
      } else if (result.kind === want) {
        setMessage(null);
        onRead(result);
      }
    }

    return () => {
      cancelled = true;
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
