import { fireEvent, render } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AlphaRail } from "./AlphaRail";
import { RAIL_STRIP } from "./model";

// 28 marks over 280px: each mark is 10px tall, the "↑" first (0-10), then A (10-20).
const setup = (present: string[]) => {
  const onPick = vi.fn();
  const onTop = vi.fn();
  const { container } = render(<AlphaRail present={present} onPick={onPick} onTop={onTop} />);
  const rail = container.querySelector<HTMLElement>(".alpha-rail")!;
  const setPointerCapture = vi.fn();
  rail.setPointerCapture = setPointerCapture;
  rail.releasePointerCapture = vi.fn();
  rail.getBoundingClientRect = () => ({ top: 100, height: 280, bottom: 380, left: 0, right: 44, width: 44, x: 0, y: 100, toJSON() {} });
  return { rail, onPick, onTop, setPointerCapture, container };
};

test("is hidden from assistive tech and keeps the browser from taking the drag", () => {
  const { rail } = setup(["A", "B"]);
  expect(rail).toHaveAttribute("aria-hidden", "true");
  expect(rail.style.touchAction).toBe("none");
});

test("draws all 28 marks, the up mark first, and marks with no books carry data-empty", () => {
  const { rail } = setup(["A", "M", "#"]);
  const marks = [...rail.querySelectorAll(".alpha-rail-mark")];
  expect(marks).toHaveLength(28);
  expect(marks.map((m) => m.textContent)).toEqual([...RAIL_STRIP]);
  expect(marks[0].textContent).toBe("↑");
  expect(marks.filter((m) => !m.hasAttribute("data-empty")).map((m) => m.textContent)).toEqual(["↑", "A", "M", "#"]);
  expect(setup([]).rail.querySelector(".alpha-rail-mark")).not.toHaveAttribute("data-empty");
});

test("pointerdown maps its height on the strip to a letter, and takes the pointer", () => {
  const { rail, onPick, setPointerCapture } = setup(["A", "D", "M"]);
  fireEvent.pointerDown(rail, { clientY: 135, pointerId: 7 }); // offset 35: the fourth band, C, so the next letter with books, D
  expect(onPick).toHaveBeenCalledWith("D");
  expect(setPointerCapture).toHaveBeenCalledWith(7);
});

test("dragging picks each new letter once and shows it in a bubble, which goes on release", () => {
  const { rail, onPick, container } = setup(["A", "D", "M"]);
  fireEvent.pointerDown(rail, { clientY: 111, pointerId: 1 });
  expect(onPick).toHaveBeenLastCalledWith("A");
  expect(container.querySelector(".alpha-rail-bubble")).toHaveTextContent("A");
  fireEvent.pointerMove(rail, { clientY: 113, pointerId: 1 });
  expect(onPick).toHaveBeenCalledTimes(1);
  fireEvent.pointerMove(rail, { clientY: 235, pointerId: 1 }); // offset 135: the 14th band, M
  expect(onPick).toHaveBeenLastCalledWith("M");
  expect(container.querySelector(".alpha-rail-bubble")).toHaveTextContent("M");
  expect(container.querySelector(".alpha-rail-bubble")).toHaveAttribute("aria-hidden", "true");
  fireEvent.pointerUp(rail, { clientY: 235, pointerId: 1 });
  expect(container.querySelector(".alpha-rail-bubble")).toBeNull();
  fireEvent.pointerMove(rail, { clientY: 111, pointerId: 1 });
  expect(onPick).toHaveBeenCalledTimes(2);
});

test("a cancelled drag ends it too", () => {
  const { rail, onPick, container } = setup(["A", "M"]);
  fireEvent.pointerDown(rail, { clientY: 111, pointerId: 1 });
  fireEvent.pointerCancel(rail, { pointerId: 1 });
  expect(container.querySelector(".alpha-rail-bubble")).toBeNull();
  fireEvent.pointerMove(rail, { clientY: 235, pointerId: 1 });
  expect(onPick).toHaveBeenCalledTimes(1);
});

test("a fresh press picks its letter again even if it is the same", () => {
  const { rail, onPick } = setup(["A", "M"]);
  fireEvent.pointerDown(rail, { clientY: 111, pointerId: 1 });
  fireEvent.pointerUp(rail, { clientY: 111, pointerId: 1 });
  fireEvent.pointerDown(rail, { clientY: 111, pointerId: 2 });
  expect(onPick).toHaveBeenCalledTimes(2);
});

test("the top band calls onTop, not onPick, and shows an arrow in the bubble", () => {
  const { rail, onPick, onTop, container } = setup(["A", "B"]);
  fireEvent.pointerDown(rail, { clientY: 100, pointerId: 1 }); // offset 0
  expect(onTop).toHaveBeenCalledTimes(1);
  expect(onPick).not.toHaveBeenCalled();
  expect(container.querySelector(".alpha-rail-bubble")).toHaveTextContent("↑");
  fireEvent.pointerMove(rail, { clientY: 109, pointerId: 1 }); // offset 9: still the top band
  expect(onTop).toHaveBeenCalledTimes(1);
});

test("dragging from the top band to B and back calls onTop twice and onPick for B once", () => {
  const { rail, onPick, onTop } = setup(["A", "B"]);
  fireEvent.pointerDown(rail, { clientY: 105, pointerId: 1 });
  fireEvent.pointerMove(rail, { clientY: 125, pointerId: 1 }); // offset 25: B
  fireEvent.pointerMove(rail, { clientY: 103, pointerId: 1 });
  expect(onTop).toHaveBeenCalledTimes(2);
  expect(onPick).toHaveBeenCalledTimes(1);
  expect(onPick).toHaveBeenCalledWith("B");
});
