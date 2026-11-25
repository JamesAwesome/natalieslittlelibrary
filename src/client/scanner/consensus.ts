// Accepts a raw value only after it has been read in `need` frames running.
// A non-empty frame that lacks a value restarts that value's count; an empty
// frame neither advances nor restarts anything until `expireMs` has passed.
// An accepted value is not accepted again until it has been absent `expireMs`.
export const CONSENSUS_EXPIRE_MS = 1500;

type Run = { count: number; last: number; delivered: boolean };

export function createConsensus(need = 3, expireMs = CONSENSUS_EXPIRE_MS): { feed(values: string[], now: number): string | null } {
  const runs = new Map<string, Run>();

  function feed(values: string[], now: number): string | null {
    const inFrame = new Set(values);

    for (const [value, run] of runs) {
      if (now - run.last >= expireMs) runs.delete(value);
      else if (inFrame.size > 0 && !inFrame.has(value)) run.count = 0;
    }

    let accepted: string | null = null;
    for (const value of inFrame) {
      const run = runs.get(value) ?? { count: 0, last: now, delivered: false };
      run.count += 1;
      run.last = now;
      runs.set(value, run);
      if (accepted === null && run.count >= need && !run.delivered) {
        run.delivered = true;
        accepted = value;
      }
    }
    return accepted;
  }

  return { feed };
}
