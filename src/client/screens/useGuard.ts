import { useCallback, useEffect, useRef, useState } from "react";

// One action at a time: a second tap while one is running is dropped before it sends anything.
export function useGuard() {
  const inFlight = useRef(false);
  const live = useRef(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const guard = useCallback(async (fn: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      inFlight.current = false;
      if (live.current) setBusy(false);
    }
  }, []);
  return { busy, guard, live };
}
