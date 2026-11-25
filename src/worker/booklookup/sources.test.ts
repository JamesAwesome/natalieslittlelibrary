import { afterEach, beforeEach, expect, test, vi } from "vitest";
import found from "./fixtures/found.json";
import miss from "./fixtures/miss.json";
import googleFound from "./fixtures/google-found.json";
import googleMiss from "./fixtures/google-miss.json";
import googleOther from "./fixtures/google-other-isbn.json";
import { googleBooks, openLibrary } from "./sources";

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

const signal = () => new AbortController().signal;
const UA = "NataliesLittleLibrary/1 (+https://github.com/JamesAwesome/natalieslittlelibrary)";
const volume = (volumeInfo: unknown) => ({ totalItems: 1, items: [{ volumeInfo }] });

test("asks Google Books by ISBN with the key, naming the app", async () => {
  const calls: Call[] = [];
  await googleBooks("test-key").find(FOUND_ISBN, serve(googleFound, calls), signal());
  const url = new URL(calls[0].url);
  expect(url.origin + url.pathname).toBe("https://www.googleapis.com/books/v1/volumes");
  expect(url.searchParams.get("q")).toBe(`isbn:${FOUND_ISBN}`);
  expect(url.searchParams.get("key")).toBe("test-key");
  expect(new Headers(calls[0].init?.headers).get("user-agent")).toBe(UA);
});

test("a key with & or = cannot add parameters", async () => {
  const calls: Call[] = [];
  await googleBooks("a&q=isbn:1&x=y").find(FOUND_ISBN, serve(googleMiss, calls), signal());
  const url = new URL(calls[0].url);
  expect(url.searchParams.get("q")).toBe(`isbn:${FOUND_ISBN}`);
  expect(url.searchParams.get("x")).toBeNull();
  expect(url.searchParams.get("key")).toBe("a&q=isbn:1&x=y");
});

test("passes the abort signal to the request", async () => {
  const calls: Call[] = [];
  const controller = new AbortController();
  await googleBooks("test-key").find(FOUND_ISBN, serve(googleFound, calls), controller.signal);
  expect(calls[0].init?.signal).toBe(controller.signal);
});

test("what the source sends is a request workerd accepts", async () => {
  const calls: Call[] = [];
  await googleBooks("test-key").find(FOUND_ISBN, serve(googleFound, calls), signal());
  expect(() => new Request(calls[0].url, calls[0].init)).not.toThrow();
});

test("a found volume gives its title (no subtitle), every author, and an https cover without the curl", async () => {
  const book = await googleBooks("test-key").find(FOUND_ISBN, serve(googleFound), signal());
  expect(book).toEqual({
    isbn: FOUND_ISBN,
    title: googleFound.items[0].volumeInfo.title,
    authors: googleFound.items[0].volumeInfo.authors,
    coverUrl: expect.stringMatching(/^https:\/\/books\.google\.com\/books\/content\?/),
  });
  expect(book!.coverUrl).not.toContain("edge=curl");
  expect(book!.coverUrl).not.toContain("test-key");
});

test("totalItems 0 is not found", async () => {
  expect(await googleBooks("test-key").find(FOUND_ISBN, serve(googleMiss), signal())).toBeNull();
});

test("a volume for a different ISBN is not found", async () => {
  expect(await googleBooks("test-key").find(FOUND_ISBN, serve(googleOther), signal())).toBeNull();
});

test("an ISBN-10 identifier that matches counts", async () => {
  // 979-prefixed ISBNs have no ISBN-10, so this uses the other fixture's 978 book (ISBN-10 3141592659).
  const body = volume({ title: "T", authors: [], industryIdentifiers: [{ type: "ISBN_10", identifier: "3141592659" }] });
  expect(await googleBooks("test-key").find(MISS_ISBN, serve(body), signal())).toMatchObject({ isbn: MISS_ISBN, title: "T" });
});

test("the first matching volume is used, not the first volume", async () => {
  const body = {
    items: [
      { volumeInfo: { title: "Wrong", industryIdentifiers: googleOther.items[0].volumeInfo.industryIdentifiers } },
      googleFound.items[0],
    ],
  };
  const book = await googleBooks("test-key").find(FOUND_ISBN, serve(body), signal());
  expect(book?.title).toBe(googleFound.items[0].volumeInfo.title);
});

test.each([429, 403, 500])("a %i answer throws, so the lookup treats it as a failure", async (status) => {
  const f = (async () => new Response("{}", { status })) as typeof fetch;
  await expect(googleBooks("test-key").find(FOUND_ISBN, f, signal())).rejects.toThrow();
});

test.each([
  ["items not an array", { items: "x" }],
  ["volumeInfo missing", { items: [{}] }],
  ["title not a string", volume({ title: 5, industryIdentifiers: [{ type: "ISBN_13", identifier: FOUND_ISBN }] })],
  ["identifiers not an array", volume({ title: "T", industryIdentifiers: "x" })],
  ["body not an object", null],
])("a body of the wrong shape is not found: %s", async (_name, body) => {
  expect(await googleBooks("test-key").find(FOUND_ISBN, serve(body), signal())).toBeNull();
});

test("no thumbnail gives a null cover", async () => {
  const body = volume({ title: "T", industryIdentifiers: [{ type: "ISBN_13", identifier: FOUND_ISBN }] });
  expect(await googleBooks("test-key").find(FOUND_ISBN, serve(body), signal())).toMatchObject({ coverUrl: null });
});
