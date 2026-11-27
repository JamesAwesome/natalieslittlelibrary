import { fireEvent, render } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AlphaRail } from "./AlphaRail";
import { RAIL_MARKS } from "./model";

// 27 marks over 270px: each mark is 10px tall.
const setup = (present: string[]) => {
  const onPick = vi.fn();
  const { container } = render(<AlphaRail present={present} onPick={onPick} />);
  const rail = container.querySelector<HTMLElement>(".alpha-rail")!;
  const setPointerCapture = vi.fn();
  rail.setPointerCapture = setPointerCapture;
  rail.releasePointerCapture = vi.fn();
  rail.getBoundingClientRect = () => ({ top: 100, height: 270, bottom: 370, left: 0, right: 44, width: 44, x: 0, y: 100, toJSON() {} });
  return { rail, onPick, setPointerCapture, container };
};

test("is hidden from assistive tech and keeps the browser from taking the drag", () => {
  const { rail } = setup(["A", "B"]);
  expect(rail).toHaveAttribute("aria-hidden", "true");
  expect(rail.style.touchAction).toBe("none");
});

test("draws all 27 marks, and marks with no books carry data-empty", () => {
  const { rail } = setup(["A", "M", "#"]);
  const marks = [...rail.querySelectorAll(".alpha-rail-mark")];
  expect(marks.map((m) => m.textContent)).toEqual([...RAIL_MARKS]);
  expect(marks.filter((m) => !m.hasAttribute("data-empty")).map((m) => m.textContent)).toEqual(["A", "M", "#"]);
});

test("pointerdown maps its height on the strip to a letter, and takes the pointer", () => {
  const { rail, onPick, setPointerCapture } = setup(["A", "D", "M"]);
  fireEvent.pointerDown(rail, { clientY: 125, pointerId: 7 }); // offset 25: the third mark, C, so the next letter with books, D
  expect(onPick).toHaveBeenCalledWith("D");
  expect(setPointerCapture).toHaveBeenCalledWith(7);
});

test("dragging picks each new letter once and shows it in a bubble, which goes on release", () => {
  const { rail, onPick, container } = setup(["A", "D", "M"]);
  fireEvent.pointerDown(rail, { clientY: 101, pointerId: 1 });
  expect(onPick).toHaveBeenLastCalledWith("A");
  expect(container.querySelector(".alpha-rail-bubble")).toHaveTextContent("A");
  fireEvent.pointerMove(rail, { clientY: 103, pointerId: 1 });
  expect(onPick).toHaveBeenCalledTimes(1);
  fireEvent.pointerMove(rail, { clientY: 225, pointerId: 1 }); // offset 125: the 13th mark, M
  expect(onPick).toHaveBeenLastCalledWith("M");
  expect(container.querySelector(".alpha-rail-bubble")).toHaveTextContent("M");
  expect(container.querySelector(".alpha-rail-bubble")).toHaveAttribute("aria-hidden", "true");
  fireEvent.pointerUp(rail, { clientY: 225, pointerId: 1 });
  expect(container.querySelector(".alpha-rail-bubble")).toBeNull();
  fireEvent.pointerMove(rail, { clientY: 101, pointerId: 1 });
  expect(onPick).toHaveBeenCalledTimes(2);
});

test("a cancelled drag ends it too", () => {
  const { rail, onPick, container } = setup(["A", "M"]);
  fireEvent.pointerDown(rail, { clientY: 101, pointerId: 1 });
  fireEvent.pointerCancel(rail, { pointerId: 1 });
  expect(container.querySelector(".alpha-rail-bubble")).toBeNull();
  fireEvent.pointerMove(rail, { clientY: 225, pointerId: 1 });
  expect(onPick).toHaveBeenCalledTimes(1);
});

test("a fresh press picks its letter again even if it is the same", () => {
  const { rail, onPick } = setup(["A", "M"]);
  fireEvent.pointerDown(rail, { clientY: 101, pointerId: 1 });
  fireEvent.pointerUp(rail, { clientY: 101, pointerId: 1 });
  fireEvent.pointerDown(rail, { clientY: 101, pointerId: 2 });
  expect(onPick).toHaveBeenCalledTimes(2);
});
