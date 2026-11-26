import type {
  BookInfo,
  Candidates,
  CollectionSummary,
  CopyView,
  ImportResult,
  ImportRow,
  LabelView,
  LendTo,
  Member,
  Person,
  PersonSummary,
  RejectionReason,
  RequestItem,
  Shelf,
  ShelfItem,
  SheetSummary,
} from "../shared/types";

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

async function call<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(
    path,
    method === "GET"
      ? undefined
      : {
          method,
          ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
          ...(signal === undefined ? {} : { signal }),
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
  try {
    return (await res.json()) as T;
  } catch {
    // A 2xx that is not JSON (a proxy's page, say) is still a failed call, and says so the same way.
    throw new ApiError(res.status, null);
  }
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

export const listSheets = () => call<{ sheets: SheetSummary[] }>("/api/labels/sheets");

export const sheetLabels = (sheetId: string, includeMine: boolean) =>
  call<{ labels: { code: string; url: string }[] }>(`/api/labels/sheets/${id(sheetId)}${includeMine ? "?include=mine" : ""}`);

export const lookupBook = (isbn: string) =>
  call<{ book: BookInfo | null }>(`/api/books/lookup?isbn=${encodeURIComponent(isbn)}`);

export const addCopy = (
  input: ({ code: string; isbn: string } | { code: string; title: string; authors: string[] }) & { collectionId?: string },
) =>
  call<CopyView>("/api/copies", "POST", input);

export const claim = (code: string) => call<CopyView>(`/api/labels/${encodeURIComponent(code)}/claim`, "POST");

export const returnCopy = (copyId: string) => call<CopyView>(`/api/copies/${encodeURIComponent(copyId)}/return`, "POST");

const id = encodeURIComponent;

export const myCollections = () => call<{ owner: Person; collections: CollectionSummary[] }>("/api/collections/mine");
export const createCollection = (name: string) => call<CollectionSummary>("/api/collections", "POST", { name });
export const renameCollection = (collectionId: string, name: string) =>
  call<CollectionSummary>(`/api/collections/${id(collectionId)}`, "PATCH", { name });
export const deleteCollection = (collectionId: string) =>
  call<{ deleted: true }>(`/api/collections/${id(collectionId)}`, "DELETE");
export const makeDefault = (collectionId: string) =>
  call<{ collections: CollectionSummary[] }>(`/api/collections/${id(collectionId)}/default`, "POST");
export const getShelf = (collectionId: string) => call<Shelf>(`/api/collections/${id(collectionId)}`);
export const listMembers = () => call<{ members: Person[] }>("/api/members");
export const memberCollections = (memberId: string) =>
  call<{ owner: Person; collections: CollectionSummary[] }>(`/api/members/${id(memberId)}/collections`);
export const getHolding = () => call<{ items: ShelfItem[] }>("/api/holding");
export const getCandidates = (q: { isbn?: string; title?: string }) => {
  const params = new URLSearchParams();
  if (q.isbn !== undefined) params.set("isbn", q.isbn);
  if (q.title !== undefined) params.set("title", q.title);
  return call<Candidates>(`/api/copies/candidates?${params}`);
};
export const getCopy = (copyId: string) => call<CopyView>(`/api/copies/${id(copyId)}`);
export const moveCopy = (copyId: string, collectionId: string) =>
  call<CopyView>(`/api/copies/${id(copyId)}/move`, "POST", { collectionId });
export const labelCopy = (copyId: string, code: string) =>
  call<CopyView>(`/api/copies/${id(copyId)}/label`, "POST", { code });
export const relabelCopy = (copyId: string, code: string, replacing: string) =>
  call<CopyView>(`/api/copies/${id(copyId)}/relabel`, "POST", { code, replacing });
export const importRows = (collectionId: string | null, rows: ImportRow[], signal?: AbortSignal) =>
  call<ImportResult>("/api/imports", "POST", { collectionId, rows }, signal);
const copyAction = (path: string, body?: unknown) => (copyId: string) =>
  call<CopyView>(`/api/copies/${id(copyId)}/${path}`, "POST", body);
export const lendCopy = (copyId: string, to: LendTo) => call<CopyView>(`/api/copies/${id(copyId)}/lend`, "POST", { to });
export const giveCopy = (copyId: string, memberId: string) =>
  call<CopyView>(`/api/copies/${id(copyId)}/give`, "POST", { to: memberId });
export const requestCopy = copyAction("request");
export const withdrawRequest = copyAction("withdraw");
export const approveRequest = copyAction("approve");
export const declineRequest = copyAction("decline");
export const releaseCopy = copyAction("release");
export const adoptCopy = (code: string) => call<CopyView>(`/api/labels/${id(code)}/adopt`, "POST");
export const listPeople = () => call<{ people: PersonSummary[] }>("/api/people");
export const renamePerson = (personId: string, name: string) =>
  call<PersonSummary>(`/api/people/${id(personId)}/rename`, "POST", { name });
export const linkPerson = (personId: string, memberId: string) =>
  call<PersonSummary>(`/api/people/${id(personId)}/link`, "POST", { member: memberId });
export const listRequests = () => call<{ requests: RequestItem[] }>("/api/requests");
