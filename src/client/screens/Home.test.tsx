import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Home } from "./Home";

test("signed out shows the sign-in link back to this page", () => {
  render(<Home member={null} onLogout={() => {}} returnTo="/b/abc" />);
  expect(screen.getByRole("link", { name: "Sign in with Google" }))
    .toHaveAttribute("href", "/auth/login?returnTo=%2Fb%2Fabc");
});

test("signed in greets the member by name and can sign out", async () => {
  const onLogout = vi.fn();
  render(<Home member={{ id: "1", name: "Natalie", email: "n@example.com", pictureUrl: null, isAdmin: true }}
    onLogout={onLogout} returnTo="/" />);
  expect(screen.getByText("Hi, Natalie")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Sign in with Google" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(onLogout).toHaveBeenCalledOnce();
});

test("signed in links to pairing and label printing", () => {
  render(<Home member={{ id: "1", name: "Natalie", email: "n@example.com", pictureUrl: null, isAdmin: true }}
    onLogout={() => {}} returnTo="/" />);
  expect(screen.getByRole("link", { name: "Pair a book" })).toHaveAttribute("href", "/pair");
  expect(screen.getByRole("link", { name: "Print labels" })).toHaveAttribute("href", "/labels");
});

test("signed out has no pairing or label links", () => {
  render(<Home member={null} onLogout={() => {}} returnTo="/" />);
  expect(screen.queryByRole("link", { name: "Pair a book" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Print labels" })).not.toBeInTheDocument();
});

test("a notice is shown as an alert while signed in", () => {
  render(<Home member={{ id: "1", name: "Natalie", email: "n@example.com", pictureUrl: null, isAdmin: true }}
    onLogout={() => {}} returnTo="/" notice="Couldn't sign out." />);
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn't sign out.");
  expect(screen.getByText("Hi, Natalie")).toBeInTheDocument();
});

test("signed out in an in-app browser explains instead of linking to Google", () => {
  const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone) AppleWebKit/605 Mobile/15E148 Instagram 300.0");
  render(<Home member={null} onLogout={() => {}} returnTo="/" />);
  expect(screen.getByText("Google won't let you sign in inside Instagram. Open this page in Safari or Chrome.")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Sign in with Google" })).not.toBeInTheDocument();
  ua.mockRestore();
});

test("signed in links to the shelves, holding, friends and import; signed out has none", () => {
  const { unmount } = render(<Home member={{ id: "1", name: "Natalie", email: "n@example.com", pictureUrl: null, isAdmin: true }}
    onLogout={() => {}} returnTo="/" />);
  expect(screen.getByRole("link", { name: "My books" })).toHaveAttribute("href", "/mine");
  expect(screen.getByRole("link", { name: "What I'm holding" })).toHaveAttribute("href", "/holding");
  expect(screen.getByRole("link", { name: "Friends' shelves" })).toHaveAttribute("href", "/members");
  expect(screen.getByRole("link", { name: "People" })).toHaveAttribute("href", "/people");
  expect(screen.getByRole("link", { name: "Import from StoryGraph" })).toHaveAttribute("href", "/import");
  unmount();
  render(<Home member={null} onLogout={() => {}} returnTo="/" />);
  expect(screen.queryByRole("link", { name: "My books" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Import from StoryGraph" })).not.toBeInTheDocument();
});
