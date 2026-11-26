import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import type { Holder, PersonSummary } from "../../shared/types";
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

async function typed(text: string, onLend = vi.fn(), holder: Holder | null = null) {
  render(<LendBox ownerId="1" holder={holder} onLend={onLend} busy={false} />);
  const box = await screen.findByRole("textbox");
  await act(async () => {});
  await userEvent.type(box, text);
  return onLend;
}

test("typing lists matching members and unlinked placeholders, not linked ones or the owner", async () => {
  await typed("sa");
  expect(await screen.findByRole("button", { name: "Sam member" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sarah lent before" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Sasha" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Natalie" })).not.toBeInTheDocument();
});

test("offers Lend to the typed name when nothing matches exactly, and not when something does ignoring case", async () => {
  await typed("sa");
  expect(await screen.findByRole("button", { name: 'Lend to "sa"' })).toBeInTheDocument();
});

test("no typed-name offer when a suggestion matches exactly, ignoring case and spaces at the ends", async () => {
  await typed(" sARAH ");
  await screen.findByRole("button", { name: "Sarah lent before" });
  expect(screen.queryByRole("button", { name: /^Lend to "/ })).not.toBeInTheDocument();
});

test("picking each calls onLend with a member, a person or a name", async () => {
  const onLend = await typed("sa");
  await userEvent.click(await screen.findByRole("button", { name: "Sam member" }));
  await userEvent.click(screen.getByRole("button", { name: "Sarah lent before" }));
  await userEvent.click(screen.getByRole("button", { name: 'Lend to "sa"' }));
  expect(onLend.mock.calls).toEqual([[{ member: "2" }], [{ person: "p1" }], [{ name: "sa" }]]);
});

test("a name that is a linked placeholder offers its member instead of a new name", async () => {
  const onLend = await typed("sasha");
  expect(screen.queryByRole("button", { name: /^Lend to "/ })).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: "Kim member" }));
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
  render(<LendBox ownerId="1" holder={null} onLend={onLend} busy={false} />);
  await userEvent.type(screen.getByRole("textbox"), "Zed");
  await userEvent.click(await screen.findByRole("button", { name: 'Lend to "Zed"' }));
  expect(onLend).toHaveBeenCalledWith({ name: "Zed" });
});

test("busy disables the choices", async () => {
  render(<LendBox ownerId="1" holder={null} onLend={vi.fn()} busy />);
  await userEvent.type(screen.getByRole("textbox"), "Zed");
  expect(await screen.findByRole("button", { name: 'Lend to "Zed"' })).toBeDisabled();
});

test("a member and a placeholder with the same name are told apart and lend to their own target", async () => {
  vi.mocked(api.listPeople).mockResolvedValue({ people: [{ id: "p9", name: "Sam", linked: null, holding: [] }] });
  const onLend = await typed("sam");
  await userEvent.click(await screen.findByRole("button", { name: "Sam member" }));
  await userEvent.click(screen.getByRole("button", { name: "Sam lent before" }));
  expect(onLend.mock.calls).toEqual([[{ member: "2" }], [{ person: "p9" }]]);
});

test("a name over 60 characters says so and offers nothing", async () => {
  await typed("x".repeat(61));
  expect(await screen.findByText("Names are up to 60 characters.")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("an NFD member name is suggested when typed as NFC", async () => {
  vi.mocked(api.listMembers).mockResolvedValue({ members: [owner, { id: "5", name: "Jose\u0301", pictureUrl: null }] });
  const onLend = await typed("Jos\u00e9");
  await userEvent.click(await screen.findByRole("button", { name: /^Jose\u0301 member$/ }));
  expect(onLend).toHaveBeenCalledWith({ member: "5" });
});

test("the current holder is not suggested, member or placeholder", async () => {
  await typed("sa", vi.fn(), { kind: "member", person: sam });
  await screen.findByRole("button", { name: "Sarah lent before" });
  expect(screen.queryByRole("button", { name: "Sam member" })).not.toBeInTheDocument();
  cleanup();
  await typed("sa", vi.fn(), { kind: "person", id: "p1", name: "Sarah" });
  await screen.findByRole("button", { name: "Sam member" });
  expect(screen.queryByRole("button", { name: "Sarah lent before" })).not.toBeInTheDocument();
});

test("a holder who is a linked placeholder's member is not offered through the link either", async () => {
  await typed("sasha", vi.fn(), { kind: "member", person: kim });
  await screen.findByRole("textbox");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("the input has focus when the box opens", async () => {
  render(<LendBox ownerId="1" holder={null} onLend={vi.fn()} busy={false} />);
  expect(screen.getByRole("textbox")).toHaveFocus();
});

test("Enter picks the one exact match, ignoring case", async () => {
  const onLend = await typed("sARAH{Enter}");
  expect(onLend.mock.calls).toEqual([[{ person: "p1" }]]);
});

test("Enter on a name nothing matches exactly lends to the typed name", async () => {
  const onLend = await typed("sa{Enter}");
  expect(onLend.mock.calls).toEqual([[{ name: "sa" }]]);
});

test("Enter does nothing when two suggestions match exactly, or when nothing is offered", async () => {
  vi.mocked(api.listPeople).mockResolvedValue({ people: [{ id: "p9", name: "Sam", linked: null, holding: [] }] });
  const onLend = await typed("sam{Enter}");
  expect(onLend).not.toHaveBeenCalled();
  await userEvent.clear(screen.getByRole("textbox"));
  await userEvent.type(screen.getByRole("textbox"), "{Enter}");
  expect(onLend).not.toHaveBeenCalled();
});

test("Enter does nothing while busy", async () => {
  const onLend = vi.fn();
  render(<LendBox ownerId="1" holder={null} onLend={onLend} busy />);
  await userEvent.type(screen.getByRole("textbox"), "Zed{Enter}");
  expect(onLend).not.toHaveBeenCalled();
});
