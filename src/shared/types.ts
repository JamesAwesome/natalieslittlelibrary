export type Member = { id: string; name: string; email: string; pictureUrl: string | null; isAdmin: boolean };
export type RefusalReason = "not-invited" | "removed" | "unverified" | "failed";
