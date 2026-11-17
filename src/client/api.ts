import type { Member } from "../shared/types";

export async function getMe(): Promise<Member | null> {
  const res = await fetch("/api/me");
  if (!res.ok) throw new Error(`/api/me failed: ${res.status}`);
  const body = (await res.json()) as { member: Member | null };
  return body.member;
}

export async function logout(): Promise<void> {
  const res = await fetch("/auth/logout", { method: "POST" });
  if (!res.ok) throw new Error(`/auth/logout failed: ${res.status}`);
}
