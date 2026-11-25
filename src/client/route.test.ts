import { expect, test } from "vitest";
import { matchRoute } from "./route";

test.each([
  ["/", { name: "home" }],
  ["/b/abc", { name: "copy", code: "abc" }],
  ["/b/abc/", { name: "copy", code: "abc" }],
  ["/b/", { name: "not-found" }],
  ["/b", { name: "not-found" }],
  ["/b/abc/def", { name: "not-found" }],
  ["/pair", { name: "pair" }],
  ["/pair/", { name: "pair" }],
  ["/labels", { name: "labels" }],
  ["/nope", { name: "not-found" }],
  ["//b/abc", { name: "not-found" }],
])("%s", (path, route) => {
  expect(matchRoute(path)).toEqual(route);
});
