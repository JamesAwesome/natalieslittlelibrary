import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api";

export type Loaded<T> =
  | { status: "loading" }
  | { status: "ok"; data: T }
  | { status: "lost" }
  | { status: "gone" }
  | { status: "failed" };

// One read for a screen. A 401 at any time (first load or a refetch) is `lost`, a 404 is `gone`, and
// either drops the data so no stale controls outlive the answer. A later read always wins over an earlier one.
export function useLoaded<T>(load: () => Promise<T>, enabled: boolean) {
  const [state, setState] = useState<Loaded<T>>({ status: "loading" });
  const live = useRef(true);
  const latest = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const data = await loadRef.current();
      if (live.current && mine === latest.current) setState({ status: "ok", data });
    } catch (e) {
      if (!live.current || mine !== latest.current) return;
      if (e instanceof ApiError && e.status === 401) setState({ status: "lost" });
      else if (e instanceof ApiError && e.status === 404) setState({ status: "gone" });
      else setState({ status: "failed" });
    }
  }, []);

  const lose = useCallback(() => {
    latest.current++;
    setState({ status: "lost" });
  }, []);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    void reload();
  }, [reload]);

  useEffect(() => {
    live.current = true;
    if (enabled) void reload();
    return () => {
      live.current = false;
    };
  }, [enabled, reload]);

  return { state, reload, lose, retry };
}
