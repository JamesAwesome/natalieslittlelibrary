import { describe, expect, test } from "vitest";
import { createConsensus } from "./consensus";

// Feeds frames 175 ms apart; returns the (frame number, value) of every acceptance.
function run(frames: string[][], step = 175, need = 3) {
  const c = createConsensus(need);
  const accepted: { frame: number; value: string }[] = [];
  frames.forEach((values, i) => {
    const got = c.feed(values, i * step);
    if (got !== null) accepted.push({ frame: i + 1, value: got });
  });
  return accepted;
}

describe("consensus", () => {
  test("a value seen in three frames running is accepted on the third", () => {
    expect(run([["A"], ["A"], ["A"]])).toEqual([{ frame: 3, value: "A" }]);
  });

  test("two frames, then a different value, then the first again: not accepted", () => {
    expect(run([["A"], ["A"], ["B"], ["A"]])).toEqual([]);
  });

  test("a wrong value in frames 1, 3, and 5 with other values between is never accepted", () => {
    expect(run([["W"], ["X"], ["W"], ["Y"], ["W"]])).toEqual([]);
  });

  test("the recorded misread sequence accepts only the true value", () => {
    const frames = [
      "9780952486008", "0794972486008", "6780272426008", "9780952486008", "0794972486008",
      "9780952486008", "9780051486008", "9780952486008", "9780952486008", "9780952486008",
    ].map((v) => [v]);
    expect(run(frames)).toEqual([{ frame: 10, value: "9780952486008" }]);
  });

  test("empty frames between sightings do not reset the count, until 1.5 s pass", () => {
    const c = createConsensus();
    expect(c.feed(["A"], 0)).toBeNull();
    expect(c.feed([], 200)).toBeNull();
    expect(c.feed(["A"], 400)).toBeNull();
    expect(c.feed([], 600)).toBeNull();
    expect(c.feed(["A"], 800)).toBe("A");

    const d = createConsensus();
    d.feed(["A"], 0);
    d.feed(["A"], 100);
    expect(d.feed(["A"], 1600)).toBeNull(); // 1.5 s gap: count starts over
    expect(d.feed(["A"], 1700)).toBeNull();
    expect(d.feed(["A"], 1800)).toBe("A");
  });

  test("an accepted value is not accepted again while it stays in view", () => {
    const frames = Array.from({ length: 12 }, () => ["A"]);
    expect(run(frames)).toEqual([{ frame: 3, value: "A" }]);
  });

  test("a misread frame while it stays in view does not let it be accepted again", () => {
    const frames = [["A"], ["A"], ["A"], ["X"], ["A"], ["A"], ["A"]];
    expect(run(frames)).toEqual([{ frame: 3, value: "A" }]);
  });

  test("after it has been gone 1.5 s the same value can be accepted again", () => {
    const c = createConsensus();
    c.feed(["A"], 0);
    c.feed(["A"], 100);
    expect(c.feed(["A"], 200)).toBe("A");
    expect(c.feed([], 1000)).toBeNull();
    expect(c.feed(["A"], 1700)).toBeNull();
    expect(c.feed(["A"], 1800)).toBeNull();
    expect(c.feed(["A"], 1900)).toBe("A");
  });

  test("a frame with two codes: both run, each accepted once, one per call", () => {
    const frames = [["QR", "BAR"], ["BAR", "QR"], ["QR", "BAR"], ["QR", "BAR"], ["QR", "BAR"]];
    const got = run(frames);
    expect(got).toHaveLength(2);
    expect(got.map((g) => g.value).sort()).toEqual(["BAR", "QR"]);
    expect(got[0].frame).toBe(3);
    expect(got[1].frame).toBe(4);
  });

  test("a frame holding another value resets a value that is not in it", () => {
    expect(run([["A", "B"], ["A", "B"], ["B"], ["A"]])).toEqual([{ frame: 3, value: "B" }]);
  });
});
