import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import * as api from "../api";
import { Shelf } from "./Shelf";
import { ann, item, me, shelfOf, summary } from "./shelfFixtures";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, getShelf: vi.fn(), renameCollection: vi.fn(), deleteCollection: vi.fn(), makeDefault: vi.fn() };
});
beforeEach(() => vi.resetAllMocks());

const beach = summary({ id: "k2", name: "Beach house", count: 0 });
const full = summary({ id: "k2", name: "Beach house", count: 1 });
const home = summary({ id: "k1", name: "Home library", isDefault: true, count: 0 });
const show = (id = "k2", member: typeof me | null = me) => render(<Shelf id={id} member={member} returnTo={`/collections/${id}`} />);

test("shows the name and owner, and to the owner Rename, Make default, Delete", async () => {
  vi.mocked(api.getShelf).mockResolvedValue(shelfOf(beach, []));
  show();
  expect((await screen.findByText("Beach house")).tagName).toBe("BDI");
  expect(screen.getByText("Natalie").tagName).toBe("BDI");
  for (const name of ["Rename", "Make this the default", "Delete"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
});

test("a non-owner sees the shelf and no controls", async () => {
  vi.mocked(api.getShelf).mockResolvedValue(shelfOf(beach, [item({ copyId: "c1", owner: ann })], ann));
  show();
  await screen.findByText("Beach house");
  expect(screen.getByRole("link", { name: "Book c1" })).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("the default has no make-default and no delete", async () => {
  vi.mocked(api.getShelf).mockResolvedValue(shelfOf(home, []));
  show("k1");
  await screen.findByText("Home library");
  expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Make this the default" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
});

test("a non-empty collection has no delete", async () => {
  vi.mocked(api.getShelf).mockResolvedValue(shelfOf(full, [item({ copyId: "c1" })]));
  show();
  await screen.findByText("Beach house");
  expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
});

test("rename sends the cleaned name once and refetches", async () => {
  vi.mocked(api.getShelf).mockResolvedValue(shelfOf(beach, []));
  vi.mocked(api.renameCollection).mockResolvedValue(summary({ id: "k2", name: "Lake house" }));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Rename" }));
  const input = screen.getByLabelText("New name");
  expect(input).toHaveValue("Beach house");
  await userEvent.clear(input);
  await userEvent.type(input, " Lake house ");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(api.renameCollection).toHaveBeenCalledExactlyOnceWith("k2", "Lake house");
  await waitFor(() => expect(api.getShelf).toHaveBeenCalledTimes(2));
  expect(screen.queryByLabelText("New name")).not.toBeInTheDocument();
});

test("rename name-taken shows the message, keeps the form, and re-reads", async () => {
  vi.mocked(api.getShelf).mockResolvedValue(shelfOf(beach, []));
  vi.mocked(api.renameCollection).mockRejectedValue(new api.ApiError(409, "name-taken"));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Rename" }));
  await userEvent.type(screen.getByLabelText("New name"), "x");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("You already have a collection called that.")).toBeInTheDocument();
  expect(api.getShelf).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText("New name")).toBeInTheDocument();
});

test("a double tap on Save sends one request", async () => {
  vi.mocked(api.getShelf).mockResolvedValue(shelfOf(beach, []));
  let finish: (v: ReturnType<typeof summary>) => void = () => {};
  vi.mocked(api.renameCollection).mockReturnValue(new Promise((r) => { finish = r; }));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Rename" }));
  await userEvent.type(screen.getByLabelText("New name"), "x");
  const save = screen.getByRole("button", { name: "Save" });
  await act(async () => { save.click(); save.click(); });
  expect(api.renameCollection).toHaveBeenCalledTimes(1);
  await act(async () => finish(summary({ id: "k2", name: "x" })));
});

test("make default sends one request and refetches", async () => {
  vi.mocked(api.getShelf).mockResolvedValue(shelfOf(beach, []));
  vi.mocked(api.makeDefault).mockResolvedValue({ collections: [] });
  show();
  const button = await screen.findByRole("button", { name: "Make this the default" });
  await act(async () => { button.click(); button.click(); });
  expect(api.makeDefault).toHaveBeenCalledExactlyOnceWith("k2");
  await waitFor(() => expect(api.getShelf).toHaveBeenCalledTimes(2));
});

test("make default refused says so and re-reads", async () => {
  vi.mocked(api.getShelf).mockResolvedValue(shelfOf(beach, []));
  vi.mocked(api.makeDefault).mockRejectedValue(new api.ApiError(403, "not-allowed"));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Make this the default" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("can't be made the default");
  expect(api.getShelf).toHaveBeenCalledTimes(2);
});

test("delete asks first, and Keep it sends nothing", async () => {
  vi.mocked(api.getShelf).mockResolvedValue(shelfOf(beach, []));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
  expect(screen.getByText(/^Delete/, { selector: "p" })).toHaveTextContent("Delete Beach house?");
  await userEvent.click(screen.getByRole("button", { name: "Keep it" }));
  expect(api.deleteCollection).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
});

test("confirmed delete sends once, then says it is gone with a way back", async () => {
  vi.mocked(api.getShelf).mockResolvedValueOnce(shelfOf(beach, [])).mockRejectedValue(new api.ApiError(404, null));
  vi.mocked(api.deleteCollection).mockResolvedValue({ deleted: true });
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
  const yes = screen.getByRole("button", { name: "Yes, delete it" });
  await act(async () => { yes.click(); yes.click(); });
  expect(api.deleteCollection).toHaveBeenCalledExactlyOnceWith("k2");
  expect(await screen.findByRole("link", { name: "Back to my books" })).toHaveAttribute("href", "/mine");
});

test("delete refused (not empty any more) says so and re-reads the truth", async () => {
  vi.mocked(api.getShelf).mockResolvedValueOnce(shelfOf(beach, [])).mockResolvedValue(shelfOf(full, [item({ copyId: "c1" })]));
  vi.mocked(api.deleteCollection).mockRejectedValue(new api.ApiError(403, "not-allowed"));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
  await userEvent.click(screen.getByRole("button", { name: "Yes, delete it" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("can't be deleted");
  expect(await screen.findByRole("link", { name: "Book c1" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Yes, delete it" })).not.toBeInTheDocument();
});

test("a 404 on load (removed member, deleted collection) is not-found, not an error", async () => {
  vi.mocked(api.getShelf).mockRejectedValue(new api.ApiError(404, null));
  show();
  expect(await screen.findByText("That collection isn't here.")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("a 401 on load shows sign-in back to the shelf", async () => {
  vi.mocked(api.getShelf).mockRejectedValue(new api.ApiError(401, null));
  show();
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/login?returnTo=%2Fcollections%2Fk2");
});

test("a 401 on an action drops every control and shows sign-in", async () => {
  vi.mocked(api.getShelf).mockResolvedValue(shelfOf(beach, []));
  vi.mocked(api.makeDefault).mockRejectedValue(new api.ApiError(401, null));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Make this the default" }));
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByText("Beach house")).not.toBeInTheDocument();
});

test("a 401 on the re-read after a refusal shows sign-in", async () => {
  vi.mocked(api.getShelf).mockResolvedValueOnce(shelfOf(beach, [])).mockRejectedValue(new api.ApiError(401, null));
  vi.mocked(api.makeDefault).mockRejectedValue(new api.ApiError(403, "not-allowed"));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Make this the default" }));
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("signed out: only the sign-in link", () => {
  show("k2", null);
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(api.getShelf).not.toHaveBeenCalled();
});

test("navigating to another shelf starts from nothing (open rename form, notice)", async () => {
  vi.mocked(api.getShelf).mockResolvedValueOnce(shelfOf(beach, []));
  const { rerender } = show();
  await userEvent.click(await screen.findByRole("button", { name: "Rename" }));
  expect(screen.getByLabelText("New name")).toBeInTheDocument();
  vi.mocked(api.getShelf).mockResolvedValue(shelfOf(home, []));
  rerender(<Shelf id="k1" member={me} returnTo="/collections/k1" />);
  await screen.findByText("Home library");
  expect(screen.queryByLabelText("New name")).not.toBeInTheDocument();
  expect(api.getShelf).toHaveBeenLastCalledWith("k1");
});
