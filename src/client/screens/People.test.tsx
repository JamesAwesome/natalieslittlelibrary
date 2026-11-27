import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import * as api from "../api";
import type { PersonSummary } from "../../shared/types";
import { People } from "./People";
import { item, me } from "./shelfFixtures";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, listPeople: vi.fn(), renamePerson: vi.fn(), linkPerson: vi.fn(), listMembers: vi.fn() };
});
beforeEach(() => vi.resetAllMocks());

const sam = { id: "3", name: "Sam", pictureUrl: null };
const sarah: PersonSummary = { id: "p1", name: "Sarah", linked: null, holding: [item({ copyId: "h1" })] };
const linked: PersonSummary = { id: "p2", name: "Tom", linked: sam, holding: [] };
const show = () => render(<People member={me} returnTo="/people" />);

test("lists people with what each holds", async () => {
  vi.mocked(api.listPeople).mockResolvedValue({ people: [sarah, linked] });
  show();
  expect(await screen.findByRole("heading", { name: "Sarah" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Book h1" })).toHaveAttribute("href", "/copies/h1");
  expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Linked to Sam")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Link" })).toHaveLength(1);
});

test("rename sends the new name and reloads", async () => {
  vi.mocked(api.listPeople).mockResolvedValue({ people: [sarah] });
  vi.mocked(api.renamePerson).mockResolvedValue({ ...sarah, name: "Sally" });
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Rename" }));
  const input = screen.getByLabelText("Name");
  await userEvent.clear(input);
  await userEvent.type(input, "Sally");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(api.renamePerson).toHaveBeenCalledExactlyOnceWith("p1", "Sally");
  expect(api.listPeople).toHaveBeenCalledTimes(2);
});

test("a taken name is explained", async () => {
  vi.mocked(api.listPeople).mockResolvedValue({ people: [sarah] });
  vi.mocked(api.renamePerson).mockRejectedValue(new api.ApiError(409, "name-taken"));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Rename" }));
  await userEvent.type(screen.getByLabelText("Name"), "x");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("You already have someone called that.")).toBeInTheDocument();
});

test("link: pick a member, confirm, then link", async () => {
  vi.mocked(api.listPeople).mockResolvedValue({ people: [sarah] });
  vi.mocked(api.listMembers).mockResolvedValue({ members: [{ id: "1", name: "Natalie", pictureUrl: null }, sam] });
  vi.mocked(api.linkPerson).mockResolvedValue({ ...sarah, linked: sam });
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Link" }));
  const list = await screen.findByRole("list", { name: "Members" });
  expect(within(list).queryByText("Natalie")).not.toBeInTheDocument();
  await userEvent.click(within(list).getByRole("button", { name: "Sam" }));
  expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Link Sarah to Sam? The books Sarah has will show as theirs.")).toBeInTheDocument();
  expect(screen.getAllByText("Sarah", { selector: "bdi" }).length).toBeGreaterThan(0);
  expect(screen.getByText("Sam", { selector: "p bdi" })).toBeInTheDocument();
  expect(api.linkPerson).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Link" }));
  expect(api.linkPerson).toHaveBeenCalledExactlyOnceWith("p1", "3");
  expect(api.listPeople).toHaveBeenCalledTimes(2);
});

test("signed out shows sign-in and fetches nothing", () => {
  render(<People member={null} returnTo="/people" />);
  expect(screen.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/login?returnTo=%2Fpeople");
  expect(api.listPeople).not.toHaveBeenCalled();
});

test("a 401 on load shows sign-in", async () => {
  vi.mocked(api.listPeople).mockRejectedValue(new api.ApiError(401, null));
  show();
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
});

test("an invalid rename is refused before sending", async () => {
  vi.mocked(api.listPeople).mockResolvedValue({ people: [sarah] });
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Rename" }));
  await userEvent.clear(screen.getByLabelText("Name"));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByText("A name is 1 to 60 characters, with no control characters.")).toBeInTheDocument();
  expect(api.renamePerson).not.toHaveBeenCalled();
});

test("a refused link says so, closes the confirm and reloads", async () => {
  vi.mocked(api.listPeople).mockResolvedValue({ people: [sarah] });
  vi.mocked(api.listMembers).mockResolvedValue({ members: [sam] });
  vi.mocked(api.linkPerson).mockRejectedValue(new api.ApiError(403, "not-allowed"));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Link" }));
  await userEvent.click(await screen.findByRole("button", { name: "Sam" }));
  await userEvent.click(screen.getByRole("button", { name: "Link" }));
  expect(await screen.findByText("That link can't be made now.")).toBeInTheDocument();
  expect(screen.queryByText(/^Link Sarah to Sam/)).not.toBeInTheDocument();
  expect(api.listPeople).toHaveBeenCalledTimes(2);
});

test("the h1 is People, with no second People heading", async () => {
  vi.mocked(api.listPeople).mockResolvedValue({ people: [sarah] });
  show();
  expect(screen.getByRole("heading", { level: 1, name: "People" })).toBeInTheDocument();
  await screen.findByRole("heading", { name: "Sarah" });
  expect(screen.getAllByRole("heading", { name: "People" })).toHaveLength(1);
});

test("signed out, the h1 is the app name", () => {
  render(<People member={null} returnTo="/people" />);
  expect(screen.getByRole("heading", { level: 1, name: "Natalie's Little Library" })).toBeInTheDocument();
});

test("a lost session turns the h1 into the app name", async () => {
  vi.mocked(api.listPeople).mockRejectedValue(new api.ApiError(401, null));
  show();
  expect(await screen.findByRole("heading", { level: 1, name: "Natalie's Little Library" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "People" })).not.toBeInTheDocument();
});

test("each person's name is an h2 under the h1", async () => {
  vi.mocked(api.listPeople).mockResolvedValue({ people: [sarah] });
  show();
  expect(await screen.findByRole("heading", { level: 2, name: "Sarah" })).toBeInTheDocument();
  expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
});
