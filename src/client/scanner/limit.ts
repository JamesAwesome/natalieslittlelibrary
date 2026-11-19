export class LimitError extends Error {
  constructor(ms: number) {
    super(`no answer in ${ms} ms`);
  }
}

// Rejects with LimitError if `p` has not settled within `ms`.
export function withLimit<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LimitError(ms)), ms);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}
