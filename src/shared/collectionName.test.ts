import { expect, test } from "vitest";
import { cleanCollectionName } from "./collectionName";

test.each([
  ["  Beach house  ", "Beach house", "beach house"],
  ["École", "École", "école"],
  ["École", "École", "école"], // NFD in, NFC out
  ["x".repeat(60), "x".repeat(60), "x".repeat(60)],
  ["👍".repeat(60), "👍".repeat(60), "👍".repeat(60)], // 60 code points, 120 UTF-16 units
])("%j is name %j with key %j", (raw, name, key) => {
  expect(cleanCollectionName(raw)).toEqual({ name, key });
});

test.each(["", "   ", "x".repeat(61), "👍".repeat(61), "a\nb", "a\u0000b", "‮evil", "a⁦b", "a‪b", "a⁩b", 42, null, undefined])(
  "%j is refused",
  (raw) => {
    expect(cleanCollectionName(raw)).toBeNull();
  },
);

test.each(["a​b", "a‎b", "a‏b", "a؜b", "a b", "a b", "a﻿b", "a­b", "a\u{e0041}b", "a\ud800b"])(
  "%j (format, separator or surrogate) is refused",
  (raw) => {
    expect(cleanCollectionName(raw)).toBeNull();
  },
);
