import type { BookInfo, CopyView, LabelView, Member, RejectionReason, Suggestion } from "../shared/types";

export class ApiError extends Error {
  status: number;
  rejected: RejectionReason | null;
  constructor(status: number, rejected: RejectionReason | null, message?: string) {
    super(message ?? `request failed: ${status}${rejected ? ` (${rejected})` : ""}`);
    this.name = "ApiError";
    this.status = status;
    this.rejected = rejected;
  }
}

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(
    path,
    method === "GET"
      ? undefined
      : {
          method,
          ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        },
  );
  if (!res.ok) {
    let rejected: RejectionReason | null = null;
    try {
      const parsed = (await res.json()) as { rejected?: unknown } | null;
      if (typeof parsed?.rejected === "string") rejected = parsed.rejected as RejectionReason;
    } catch {
      // Not JSON: the status alone says what happened.
    }
    throw new ApiError(res.status, rejected);
  }
  return (await res.json()) as T;
}

export async function getMe(): Promise<Member | null> {
  const body = await call<{ member?: Member | null }>("/api/me");
  return body.member ?? null;
}

export async function logout(): Promise<void> {
  const res = await fetch("/auth/logout", { method: "POST" });
  if (!res.ok) throw new Error(`/auth/logout failed: ${res.status}`);
}

export const getLabel = (code: string) => call<LabelView>(`/api/labels/${encodeURIComponent(code)}`);

export const mintLabels = (count: number) =>
  call<{ labels: { code: string; url: string }[] }>("/api/labels", "POST", { count });

export const lookupBook = (isbn: string) =>
  call<{ book: BookInfo | null; suggestion: Suggestion | null }>(`/api/books/lookup?isbn=${encodeURIComponent(isbn)}`);

export const addCopy = (input: { code: string; isbn: string } | { code: string; title: string; authors: string[] }) =>
  call<CopyView>("/api/copies", "POST", input);

export const claim = (code: string) => call<CopyView>(`/api/labels/${encodeURIComponent(code)}/claim`, "POST");

export const returnCopy = (copyId: string) => call<CopyView>(`/api/copies/${encodeURIComponent(copyId)}/return`, "POST");
