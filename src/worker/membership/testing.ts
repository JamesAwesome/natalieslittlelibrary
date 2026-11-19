import { createMembership } from "./index";
import type { Identity, IdentityProvider, MembershipConfig } from "./index";
import type { Member } from "../../shared/types";

export type RecordingProvider = IdentityProvider & {
  authorizations: { state: string; codeVerifier: string }[];
  exchanges: { code: string; codeVerifier: string }[];
};

export function fakeProvider(result: Identity | Error): RecordingProvider {
  const authorizations: RecordingProvider["authorizations"] = [];
  const exchanges: RecordingProvider["exchanges"] = [];
  return {
    authorizations,
    exchanges,
    authorizationUrl: async (state, codeVerifier) => {
      authorizations.push({ state, codeVerifier });
      return new URL(`https://idp.test/auth?state=${encodeURIComponent(state)}`);
    },
    exchange: async (code, codeVerifier) => {
      exchanges.push({ code, codeVerifier });
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

const TEST_CONFIG: MembershipConfig = { siteUrl: "https://books.test", allowlist: "", admins: "" };

// Signs `identity` in through the real beginLogin and completeLogin. The identity's
// email is allowlisted unless `config` says otherwise. `cookie` is a Cookie header value.
export async function signInAs(
  db: D1Database,
  identity: Identity,
  config: Partial<MembershipConfig> = {},
): Promise<{ member: Member; cookie: string }> {
  const full: MembershipConfig = { ...TEST_CONFIG, allowlist: identity.email, ...config };
  const membership = createMembership({ db, provider: fakeProvider(identity), config: full });
  const cookiesOf = (res: Response) =>
    res.headers.getSetCookie().filter((c) => !c.includes("Max-Age=0")).map((c) => c.split(";")[0]).join("; ");

  const begin = await membership.beginLogin(null);
  const state = new URL(begin.headers.get("location")!).searchParams.get("state")!;
  const done = await membership.completeLogin(
    new Request(`${full.siteUrl}/auth/callback?code=test&state=${encodeURIComponent(state)}`,
      { headers: { cookie: cookiesOf(begin) } }),
  );
  const cookie = cookiesOf(done);
  const found = await membership.identify(new Request(`${full.siteUrl}/`, { headers: { cookie } }));
  if (found.status !== "member") throw new Error(`signInAs: sign-in did not produce a session (${done.headers.get("location")})`);
  return { member: found.member, cookie };
}
