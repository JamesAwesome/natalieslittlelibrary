import { env } from "cloudflare:workers";
import { vi } from "vitest";
import type { BookInfo, CopyView, LabelView, Member, Rejection } from "../src/shared/types";
import { createLedger, type Ledger } from "../src/worker/ledger";

export const natalie: Member = { id: "m-natalie", name: "Natalie", email: "natalie@example.com", pictureUrl: "https://p.test/n.jpg", isAdmin: true };
export const sam: Member = { id: "m-sam", name: "Sam", email: "sam@example.com", pictureUrl: null, isAdmin: false };
export const kim: Member = { id: "m-kim", name: "Kim", email: "kim@example.com", pictureUrl: null, isAdmin: false };

export const DUNE: BookInfo = { isbn: "9780441172719", title: "Dune", authors: ["Frank Herbert"], coverUrl: "https://covers.openlibrary.org/b/id/1-L.jpg" };
export const EMMA: BookInfo = { isbn: "9780141439587", title: "Emma", authors: ["Jane Austen"], coverUrl: null };

export type Deps = Partial<Parameters<typeof createLedger>[0]>;

export function make(deps: Deps = {}) {
  const lookup = vi.fn(async (isbn: string): Promise<BookInfo | null> => (isbn === DUNE.isbn ? DUNE : isbn === EMMA.isbn ? EMMA : null));
  const lookupMany = vi.fn<(isbns: string[]) => Promise<Map<string, BookInfo>>>(async () => new Map());
  const ledger = createLedger({ db: env.DB, siteUrl: "https://books.test", lookup, lookupMany, now: () => 1000, ...deps });
  return { ledger, lookup, lookupMany };
}

export async function count(table: string): Promise<number> {
  return (await env.DB.prepare(`select count(*) as n from ${table}`).first<{ n: number }>())!.n;
}

export async function mint(ledger: Ledger, n = 1): Promise<string[]> {
  const r = await ledger.mintLabels(natalie, n);
  if ("rejected" in r) throw new Error(r.rejected);
  return r.map((l) => l.code);
}

export function ok<T>(r: T | Rejection): T {
  if (r && typeof r === "object" && "rejected" in r) throw new Error(`rejected: ${(r as Rejection).rejected}`);
  return r as T;
}

export function asCopy(v: LabelView): CopyView {
  if (v.kind !== "copy") throw new Error(`expected copy, got ${v.kind}`);
  return v.copy;
}

// Natalie's copy of Dune, labelled and at home.
export async function homeCopy(ledger: Ledger): Promise<{ code: string; copyId: string }> {
  const [code] = await mint(ledger);
  const copy = ok(await ledger.add(natalie, { code, book: { isbn: DUNE.isbn! } }));
  return { code, copyId: copy.copyId };
}

// The three members every ledger test starts with.
export async function insertMembers(): Promise<void> {
  for (const m of [natalie, sam, kim]) {
    await env.DB.prepare("insert into members (id, name, email, picture_url, created_at) values (?, ?, ?, ?, 0)")
      .bind(m.id, m.name, m.email, m.pictureUrl).run();
  }
}
