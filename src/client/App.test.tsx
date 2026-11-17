import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "./App";
import * as api from "./api";

vi.mock("./api");

const natalie = { id: "1", name: "Natalie", email: "n@example.com", pictureUrl: null, isAdmin: true };
const reload = vi.fn();

beforeEach(() => {
  vi.mocked(api.getMe).mockResolvedValue(null);
  vi.mocked(api.logout).mockResolvedValue();
  reload.mockReset();
  vi.stubGlobal("location", { pathname: "/", search: "", reload });
});
afterEach(() => {
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

function at(url: string) {
  const u = new URL(url, "http://localhost");
  vi.stubGlobal("location", { pathname: u.pathname, search: u.search, reload });
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

test("sign out calls the API, then reloads", async () => {
  vi.mocked(api.getMe).mockResolvedValue(natalie);
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  expect(api.logout).toHaveBeenCalledOnce();
  expect(vi.mocked(api.logout).mock.invocationCallOrder[0]).toBeLessThan(reload.mock.invocationCallOrder[0]);
});
