import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { NotFound } from "./NotFound";

test("the h1 is the app name", () => {
  render(<NotFound />);
  expect(screen.getByRole("heading", { level: 1, name: "Natalie's Little Library" })).toBeInTheDocument();
});
