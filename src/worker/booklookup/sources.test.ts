import { afterEach, beforeEach, expect, test, vi } from "vitest";
import found from "./fixtures/found.json";
import miss from "./fixtures/miss.json";
import { openLibrary } from "./sources";

const FOUND_ISBN = "9798855427974";
const MISS_ISBN = "9783141592658";

type Call = { url: string; init: RequestInit | undefined };

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("a test made a real network request");
  });
});
afterEach(() => vi.unstubAllGlobals());

function serve(body: unknown, calls: Call[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

test("asks Open Library for the ISBN, naming the app in the User-Agent", async () => {
  const calls: Call[] = [];
  await openLibrary.find(FOUND_ISBN, serve(found, calls), new AbortController().signal);
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe(`https://openlibrary.org/api/books?bibkeys=ISBN:${FOUND_ISBN}&format=json&jscmd=data`);
  expect(new Headers(calls[0].init?.headers).get("user-agent")).toBe(
    "NataliesLittleLibrary/1 (+https://github.com/JamesAwesome/natalieslittlelibrary)",
  );
});

test("passes the abort signal to the request", async () => {
  const calls: Call[] = [];
  const controller = new AbortController();
  await openLibrary.find(FOUND_ISBN, serve(found, calls), controller.signal);
  expect(calls[0].init?.signal).toBe(controller.signal);
});

test("parses a found book: title, every author, the medium cover", async () => {
  const book = await openLibrary.find(FOUND_ISBN, serve(found), new AbortController().signal);
  expect(book).toEqual({
    isbn: FOUND_ISBN,
    title: "Guy She Was Interested in Wasn't a Guy at All, Vol. 3",
    authors: ["Sumiko Arai", "Ajani Oloye", "Brandon Bovia"],
    coverUrl: "https://covers.openlibrary.org/b/id/15232285-M.jpg",
  });
});

test("a miss (200 with an empty object) is not found", async () => {
  expect(await openLibrary.find(MISS_ISBN, serve(miss), new AbortController().signal)).toBeNull();
});

test("a book with no cover and no authors is found with a null cover and no authors", async () => {
  const body = { [`ISBN:${FOUND_ISBN}`]: { title: "Plain" } };
  expect(await openLibrary.find(FOUND_ISBN, serve(body), new AbortController().signal)).toEqual({
    isbn: FOUND_ISBN,
    title: "Plain",
    authors: [],
    coverUrl: null,
  });
});

test("a non-200 answer is not found", async () => {
  const fetch500 = (async () => new Response(JSON.stringify(found), { status: 500 })) as typeof fetch;
  expect(await openLibrary.find(FOUND_ISBN, fetch500, new AbortController().signal)).toBeNull();
});

test("a body of the wrong shape is not found", async () => {
  for (const body of [[], "text", null, { [`ISBN:${FOUND_ISBN}`]: "x" }, { [`ISBN:${FOUND_ISBN}`]: { title: 5 } }]) {
    expect(await openLibrary.find(FOUND_ISBN, serve(body), new AbortController().signal)).toBeNull();
  }
});
