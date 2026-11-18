import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { RefusalReason } from "../../shared/types";
import { Home } from "./Home";

test("signed out shows the sign-in link back to this page", () => {
  render(<Home member={null} refused={null} onLogout={() => {}} returnTo="/b/abc" />);
  expect(screen.getByRole("link", { name: "Sign in with Google" }))
    .toHaveAttribute("href", "/auth/login?returnTo=%2Fb%2Fabc");
});

test("signed in greets the member by name and can sign out", async () => {
  const onLogout = vi.fn();
  render(<Home member={{ id: "1", name: "Natalie", email: "n@example.com", pictureUrl: null, isAdmin: true }}
    refused={null} onLogout={onLogout} returnTo="/" />);
  expect(screen.getByText("Hi, Natalie")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Sign in with Google" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(onLogout).toHaveBeenCalledOnce();
});

test("signed out has no alert when not refused", () => {
  render(<Home member={null} refused={null} onLogout={() => {}} returnTo="/" />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test.each([
  ["not-invited", "This library is invite-only right now. Ask Natalie to add you."],
  ["removed", "This account no longer has access."],
  ["unverified", "Google hasn't verified that email address yet."],
  ["failed", "Sign-in didn't finish. Please try again."],
  ["unavailable", "The library is having trouble right now. Please try again later."],
  ["something-else", "Sign-in didn't finish. Please try again."],
])("refusal %s is explained", (reason, text) => {
  render(<Home member={null} refused={reason as RefusalReason} onLogout={() => {}} returnTo="/" />);
  expect(screen.getByRole("alert")).toHaveTextContent(text);
  expect(screen.getByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
});

test("a notice is shown as an alert while signed in", () => {
  render(<Home member={{ id: "1", name: "Natalie", email: "n@example.com", pictureUrl: null, isAdmin: true }}
    refused={null} onLogout={() => {}} returnTo="/" notice="Couldn't sign out." />);
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn't sign out.");
  expect(screen.getByText("Hi, Natalie")).toBeInTheDocument();
});
