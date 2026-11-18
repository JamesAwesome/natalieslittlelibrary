import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "./App";
import * as api from "./api";

vi.mock("./api");

const natalie = { id: "1", name: "Natalie", email: "n@example.com", pictureUrl: null, isAdmin: true };
const reload = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getMe).mockResolvedValue(null);
  vi.mocked(api.logout).mockResolvedValue();
  reload.mockReset();
  vi.stubGlobal("location", { pathname: "/", search: "", hash: "", reload });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

function at(url: string) {
  // Split by hand: new URL("//b/abc") would read "b" as a host.
  const [rest, hash = ""] = url.split(/(?=#)/);
  const [pathname, search = ""] = rest.split(/(?=\?)/);
  vi.stubGlobal("location", { pathname, search, hash, reload });
}

test("while loading shows only the heading", () => {
  vi.mocked(api.getMe).mockReturnValue(new Promise(() => {}));
  render(<App />);
  expect(screen.getByRole("heading", { name: "Natalie's Little Library" })).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("signed in shows the name", async () => {
  vi.mocked(api.getMe).mockResolvedValue(natalie);
  render(<App />);
  expect(await screen.findByText("Hi, Natalie")).toBeInTheDocument();
});

test("a failed getMe is treated as signed out", async () => {
  vi.mocked(api.getMe).mockRejectedValue(new Error("network"));
  render(<App />);
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("refused is shown, then removed from the address bar", async () => {
  const replace = vi.spyOn(history, "replaceState");
  at("/?refused=not-invited");
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("invite-only");
  expect(replace).toHaveBeenCalled();
  expect(replace.mock.calls.at(-1)?.[2]).toBe("/");
});

test("returnTo drops refused and keeps other parameters", async () => {
  at("/b/abc?x=1&refused=removed&y=2");
  render(<App />);
  const link = await screen.findByRole("link", { name: "Sign in with Google" });
  expect(link).toHaveAttribute("href", `/auth/login?returnTo=${encodeURIComponent("/b/abc?x=1&y=2")}`);
});

test("returnTo is the bare path when refused was the only parameter", async () => {
  at("/b/abc?refused=removed");
  render(<App />);
  const link = await screen.findByRole("link", { name: "Sign in with Google" });
  expect(link).toHaveAttribute("href", "/auth/login?returnTo=%2Fb%2Fabc");
});

test("sign out reloads only after the API call resolves", async () => {
  vi.mocked(api.getMe).mockResolvedValue(natalie);
  let finish!: () => void;
  vi.mocked(api.logout).mockReturnValue(new Promise<void>((r) => { finish = r; }));
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  expect(api.logout).toHaveBeenCalledOnce();
  expect(reload).not.toHaveBeenCalled();
  finish();
  await waitFor(() => expect(reload).toHaveBeenCalledOnce());
});

test("a failed sign-out says so, stays signed in, and does not reload", async () => {
  vi.mocked(api.getMe).mockResolvedValue(natalie);
  vi.mocked(api.logout).mockRejectedValue(new Error("offline"));
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't sign out. Check your connection and try again.");
  expect(screen.getByText("Hi, Natalie")).toBeInTheDocument();
  expect(reload).not.toHaveBeenCalled();
});

test("a path starting with // still renders and loads the member once", async () => {
  at("//b/abc");
  render(<App />);
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toHaveAttribute(
    "href", `/auth/login?returnTo=${encodeURIComponent("//b/abc")}`);
  expect(api.getMe).toHaveBeenCalledOnce();
});

test("removing refused keeps the fragment", async () => {
  const replace = vi.spyOn(history, "replaceState");
  at("/b/abc?refused=failed#x");
  render(<App />);
  await screen.findByRole("alert");
  expect(replace).toHaveBeenCalledOnce();
  expect(replace.mock.calls[0][2]).toBe("/b/abc#x");
});

test("replaceState is not called when there is no refused parameter", async () => {
  const replace = vi.spyOn(history, "replaceState");
  at("/b/abc?x=1");
  render(<App />);
  await screen.findByRole("link", { name: "Sign in with Google" });
  expect(replace).not.toHaveBeenCalled();
});

test("if replaceState throws the page still renders the refusal and sign-in link", async () => {
  vi.spyOn(history, "replaceState").mockImplementation(() => { throw new DOMException("no", "SecurityError"); });
  at("//b/abc?refused=failed");
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in didn't finish");
  expect(screen.getByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
  expect(api.getMe).toHaveBeenCalledOnce();
});
