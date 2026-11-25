import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, test } from "vitest";
import { invariantViolations } from "../../test/invariant";
import { resetDatabase } from "../../test/reset";
import type { CopyView, LabelView } from "../shared/types";
import app from "./index";
import { signInAs } from "./membership/testing";

const person = (subject: string, name: string) => ({
  provider: "google" as const, subject, email: `${subject}@example.com`, name, pictureUrl: null, emailVerified: true,
});

beforeEach(() => resetDatabase(env.DB));
afterEach(async () => {
  expect(await invariantViolations(env.DB)).toEqual([]);
});

test("print, pair, claim, return", async () => {
  const natalie = await signInAs(env.DB, person("natalie", "Natalie"));
  const james = await signInAs(env.DB, person("james", "James"));
  const call = (path: string, cookie: string | null, init: RequestInit = {}) =>
    app.request(`https://books.test${path}`, { ...init, headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" } }, env);
  const post = (path: string, cookie: string, body?: unknown) =>
    app.request(`https://books.test${path}`, {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    }, env);

  const minted = await post("/api/labels", natalie.cookie, { count: 3 });
  expect(minted.status).toBe(200);
  const { labels } = (await minted.json()) as { labels: { code: string; url: string }[] };
  expect(labels).toHaveLength(3);
  const code = labels[0].code;

  const added = await post("/api/copies", natalie.cookie, { code, title: "The Hobbit", authors: ["J. R. R. Tolkien"] });
  expect(added.status).toBe(200);
  expect(((await added.json()) as CopyView).home).toBe(true);

  const publicRes = await call(`/api/labels/${code}`, null);
  const publicText = await publicRes.text();
  expect((JSON.parse(publicText) as LabelView).kind).toBe("public");
  expect(publicText).not.toContain("Natalie");
  expect(publicText).not.toContain("@");

  const jamesView = (await (await call(`/api/labels/${code}`, james.cookie)).json()) as Extract<LabelView, { kind: "copy" }>;
  expect(jamesView.kind).toBe("copy");
  expect(jamesView.copy.actions).toEqual(["claim"]);

  const claimed = await post(`/api/labels/${code}/claim`, james.cookie);
  expect(claimed.status).toBe(200);
  const afterClaim = (await claimed.json()) as CopyView;
  expect(afterClaim.holder).toMatchObject({ kind: "member", person: { name: "James" } });
  expect((await post(`/api/labels/${code}/claim`, james.cookie)).status).toBe(403);

  const nView = (await (await call(`/api/labels/${code}`, natalie.cookie)).json()) as Extract<LabelView, { kind: "copy" }>;
  expect(nView.copy.actions).toEqual(["return", "move"]);

  const returned = await post(`/api/copies/${nView.copy.copyId}/return`, natalie.cookie);
  expect(returned.status).toBe(200);
  const final = (await returned.json()) as CopyView;
  expect(final.home).toBe(true);
  expect(final.history.map((h) => [h.type, h.actor.name])).toEqual([
    ["returned", "Natalie"], ["claimed", "James"], ["labelled", "Natalie"], ["added", "Natalie"],
  ]);
});
