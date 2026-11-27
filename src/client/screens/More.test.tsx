import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { More } from "./More";

const natalie = { id: "1", name: "Natalie", email: "n@example.com", pictureUrl: null, isAdmin: true };

test("signed in shows the heading, the greeting and the tools in order", () => {
  render(<More member={natalie} onLogout={() => {}} returnTo="/more" />);
  expect(screen.getByRole("heading", { level: 1, name: "More" })).toBeInTheDocument();
  expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Hi, Natalie")).toBeInTheDocument();
  const links = screen.getAllByRole("link");
  expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
    ["Print labels", "/labels"],
    ["People", "/people"],
    ["Import from StoryGraph", "/import"],
  ]);
});

test("Pair a book is not here: it has its own tab", () => {
  render(<More member={natalie} onLogout={() => {}} returnTo="/more" />);
  expect(screen.queryByRole("link", { name: "Pair a book" })).not.toBeInTheDocument();
});

test("Sign out calls onLogout", async () => {
  const onLogout = vi.fn();
  render(<More member={natalie} onLogout={onLogout} returnTo="/more" />);
  await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(onLogout).toHaveBeenCalledOnce();
});

test("a notice is an alert above Sign out", () => {
  render(<More member={natalie} onLogout={() => {}} returnTo="/more" notice="Couldn't sign out." />);
  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent("Couldn't sign out.");
  const button = screen.getByRole("button", { name: "Sign out" });
  expect(alert.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("signed out shows the sign-in link back to this page, and no tools", () => {
  render(<More member={null} onLogout={() => {}} returnTo="/more" />);
  expect(screen.getByRole("heading", { level: 1, name: "Natalie's Little Library" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/login?returnTo=%2Fmore");
  expect(screen.queryByRole("link", { name: "Pair a book" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
});

test("signed out in an in-app browser explains instead of linking to Google", () => {
  const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone) AppleWebKit/605 Mobile/15E148 Instagram 300.0");
  render(<More member={null} onLogout={() => {}} returnTo="/more" />);
  expect(screen.getByText("Google won't let you sign in inside Instagram. Open this page in Safari or Chrome.")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Sign in with Google" })).not.toBeInTheDocument();
  ua.mockRestore();
});
