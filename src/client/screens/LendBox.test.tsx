import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import type { PersonSummary } from "../../shared/types";
import * as api from "../api";
import { LendBox } from "./LendBox";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, listPeople: vi.fn(), listMembers: vi.fn() };
});

const owner = { id: "1", name: "Natalie", pictureUrl: null };
const sam = { id: "2", name: "Sam", pictureUrl: null };
const kim = { id: "3", name: "Kim", pictureUrl: null };
const sarah: PersonSummary = { id: "p1", name: "Sarah", linked: null, holding: [] };
const sasha: PersonSummary = { id: "p2", name: "Sasha", linked: kim, holding: [] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listMembers).mockResolvedValue({ members: [owner, sam, kim] });
  vi.mocked(api.listPeople).mockResolvedValue({ people: [sarah, sasha] });
});

async function typed(text: string, onLend = vi.fn()) {
  render(<LendBox ownerId="1" onLend={onLend} busy={false} />);
  const box = await screen.findByRole("textbox");
  await act(async () => {});
  await userEvent.type(box, text);
  return onLend;
}

test("typing lists matching members and unlinked placeholders, not linked ones or the owner", async () => {
  await typed("sa");
  expect(await screen.findByRole("button", { name: "Sam" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sarah" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Sasha" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Natalie" })).not.toBeInTheDocument();
});

test("offers Lend to the typed name when nothing matches exactly, and not when something does ignoring case", async () => {
  await typed("sa");
  expect(await screen.findByRole("button", { name: 'Lend to "sa"' })).toBeInTheDocument();
});

test("no typed-name offer when a suggestion matches exactly, ignoring case and spaces at the ends", async () => {
  await typed(" sARAH ");
  await screen.findByRole("button", { name: "Sarah" });
  expect(screen.queryByRole("button", { name: /^Lend to "/ })).not.toBeInTheDocument();
});

test("picking each calls onLend with a member, a person or a name", async () => {
  const onLend = await typed("sa");
  await userEvent.click(await screen.findByRole("button", { name: "Sam" }));
  await userEvent.click(screen.getByRole("button", { name: "Sarah" }));
  await userEvent.click(screen.getByRole("button", { name: 'Lend to "sa"' }));
  expect(onLend.mock.calls).toEqual([[{ member: "2" }], [{ person: "p1" }], [{ name: "sa" }]]);
});

test("a name that is a linked placeholder offers its member instead of a new name", async () => {
  const onLend = await typed("sasha");
  expect(screen.queryByRole("button", { name: /^Lend to "/ })).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: "Kim" }));
  expect(onLend).toHaveBeenCalledWith({ member: "3" });
});

test("a name that is a linked placeholder whose member is gone offers nothing", async () => {
  vi.mocked(api.listPeople).mockResolvedValue({ people: [{ ...sasha, linked: { ...kim, removed: true } }] });
  await typed("sasha");
  await screen.findByRole("textbox");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("a failed suggestions load still allows typing a name", async () => {
  vi.mocked(api.listPeople).mockRejectedValue(new Error("down"));
  vi.mocked(api.listMembers).mockRejectedValue(new Error("down"));
  const onLend = vi.fn();
  render(<LendBox ownerId="1" onLend={onLend} busy={false} />);
  await userEvent.type(screen.getByRole("textbox"), "Zed");
  await userEvent.click(await screen.findByRole("button", { name: 'Lend to "Zed"' }));
  expect(onLend).toHaveBeenCalledWith({ name: "Zed" });
});

test("busy disables the choices", async () => {
  render(<LendBox ownerId="1" onLend={vi.fn()} busy />);
  await userEvent.type(screen.getByRole("textbox"), "Zed");
  expect(await screen.findByRole("button", { name: 'Lend to "Zed"' })).toBeDisabled();
});
