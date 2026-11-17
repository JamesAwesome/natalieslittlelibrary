import { and, eq, gt, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Member, RefusalReason } from "../../shared/types";
import { identities, members, sessions } from "../db/schema";

export type Identity = {
  provider: "google";
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
  pictureUrl: string | null;
};

export interface IdentityProvider {
  authorizationUrl(state: string, codeVerifier: string): Promise<URL>;
  exchange(code: string, codeVerifier: string): Promise<Identity>; // throws on any failure
}

export type MembershipConfig = { siteUrl: string; allowlist: string; admins: string }; // comma-separated emails

export interface Membership {
  currentMember(request: Request): Promise<Member | null>;
  beginLogin(returnTo: string | null): Promise<Response>;
  completeLogin(request: Request): Promise<Response>;
  logout(request: Request): Promise<Response>;
}

const LOGIN_MAX_AGE_S = 600;
const SESSION_MS = 90 * 86_400_000;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url
const MAX_RETURN_TO = 1000;

class Refusal extends Error {
  constructor(readonly reason: RefusalReason) {
    super(reason);
  }
}

function emailList(raw: string): Set<string> {
  return new Set(raw.split(",").map((e) => e.trim().toLowerCase()).filter((e) => e !== ""));
}

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ (y[i % Math.max(y.length, 1)] ?? 0);
  return diff === 0;
}

function cleanReturnTo(raw: string | null): string {
  if (raw === null || raw.length > MAX_RETURN_TO) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/auth")) return "/";
  if (raw.includes("\\") || /[\x00-\x1f\x7f]/.test(raw)) return "/";
  return raw;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function createMembership(deps: {
  db: D1Database;
  provider: IdentityProvider;
  config: MembershipConfig;
  now?: () => number;
}): Membership {
  const db = drizzle(deps.db);
  const now = deps.now ?? Date.now;
  const allowlist = emailList(deps.config.allowlist);
  const admins = emailList(deps.config.admins);
  // The one place cookie names and scope are decided. On https the __Host- prefix
  // makes browsers refuse cookies with a Domain attribute, so a sibling site
  // cannot plant a lookalike. The prefix requires Path=/ and Secure.
  const https = deps.config.siteUrl.startsWith("https:");
  const secure = https ? "; Secure" : "";
  const SESSION_COOKIE = https ? "__Host-lib_session" : "lib_session";
  const LOGIN_COOKIE = https ? "__Host-lib_login" : "lib_login";
  const LOGIN_PATH = https ? "/" : "/auth";

  const setCookie = (name: string, value: string, path: string, maxAge: number) =>
    `${name}=${value}; HttpOnly; SameSite=Lax; Path=${path}; Max-Age=${maxAge}${secure}`;
  const clearLogin = () => setCookie(LOGIN_COOKIE, "", LOGIN_PATH, 0);
  const clearSession = () => setCookie(SESSION_COOKIE, "", "/", 0);

  function redirect(location: string, cookies: string[]): Response {
    const headers = new Headers({ location });
    for (const c of cookies) headers.append("set-cookie", c);
    return new Response(null, { status: 302, headers });
  }

  const refuse = (reason: RefusalReason) => redirect(`/?refused=${reason}`, [clearLogin()]);

  async function currentMember(request: Request): Promise<Member | null> {
    try {
      const token = readCookie(request, SESSION_COOKIE);
      if (token === null || !TOKEN_SHAPE.test(token)) return null;
      const rows = await db
        .select({
          id: members.id,
          name: members.name,
          email: members.email,
          pictureUrl: members.pictureUrl,
        })
        .from(sessions)
        .innerJoin(members, eq(members.id, sessions.memberId))
        .where(
          and(
            eq(sessions.tokenHash, await sha256Hex(token)),
            gt(sessions.expiresAt, now()),
            isNull(members.removedAt),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return { ...row, isAdmin: admins.has(row.email.trim().toLowerCase()) };
    } catch {
      return null;
    }
  }

  async function beginLogin(returnTo: string | null): Promise<Response> {
    const state = randomToken();
    const verifier = randomToken();
    const target = cleanReturnTo(returnTo);
    const value = `${state}.${verifier}.${toBase64Url(new TextEncoder().encode(target))}`;
    const url = await deps.provider.authorizationUrl(state, verifier);
    return redirect(url.toString(), [setCookie(LOGIN_COOKIE, value, LOGIN_PATH, LOGIN_MAX_AGE_S)]);
  }

  async function admit(identity: Identity): Promise<string> {
    if (!identity.emailVerified) throw new Refusal("unverified");

    const existing = (
      await db
        .select({ memberId: identities.memberId, removedAt: members.removedAt })
        .from(identities)
        .innerJoin(members, eq(members.id, identities.memberId))
        .where(and(eq(identities.provider, identity.provider), eq(identities.subject, identity.subject)))
        .limit(1)
    )[0];

    const token = randomToken();
    const session = {
      tokenHash: await sha256Hex(token),
      expiresAt: now() + SESSION_MS,
    };

    if (existing) {
      if (existing.removedAt !== null) throw new Refusal("removed");
      await db.batch([
        db
          .update(members)
          .set({ name: identity.name, email: identity.email, pictureUrl: identity.pictureUrl })
          .where(eq(members.id, existing.memberId)),
        db.insert(sessions).values({ ...session, memberId: existing.memberId }),
      ]);
      return token;
    }

    if (!allowlist.has(identity.email.trim().toLowerCase())) throw new Refusal("not-invited");
    const memberId = crypto.randomUUID();
    await db.batch([
      db.insert(members).values({
        id: memberId,
        name: identity.name,
        email: identity.email,
        pictureUrl: identity.pictureUrl,
        createdAt: now(),
      }),
      db.insert(identities).values({ provider: identity.provider, subject: identity.subject, memberId }),
      db.insert(sessions).values({ ...session, memberId }),
    ]);
    return token;
  }

  async function completeLogin(request: Request): Promise<Response> {
    try {
      const cookie = readCookie(request, LOGIN_COOKIE);
      const parts = cookie?.split(".") ?? [];
      if (parts.length !== 3) throw new Refusal("failed");
      const [state, verifier, encodedReturn] = parts;
      const url = new URL(request.url);
      const queryState = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      if (!state || !verifier || queryState === null || !safeEqual(state, queryState)) throw new Refusal("failed");
      if (!code) throw new Refusal("failed");

      const returnTo = cleanReturnTo(new TextDecoder().decode(fromBase64Url(encodedReturn)));
      const identity = await deps.provider.exchange(code, verifier);
      let token: string;
      try {
        token = await admit(identity);
      } catch (e) {
        if (e instanceof Refusal) throw e;
        throw new Refusal("unavailable"); // admit fails otherwise only on the database
      }
      return redirect(returnTo, [setCookie(SESSION_COOKIE, token, "/", SESSION_MS / 1000), clearLogin()]);
    } catch (e) {
      return refuse(e instanceof Refusal ? e.reason : "failed");
    }
  }

  async function logout(request: Request): Promise<Response> {
    try {
      const token = readCookie(request, SESSION_COOKIE);
      if (token !== null && TOKEN_SHAPE.test(token)) {
        await db.delete(sessions).where(eq(sessions.tokenHash, await sha256Hex(token)));
      }
    } catch {
      // Nothing to revoke if the database is unreachable; still clear the cookie.
    }
    return new Response(null, { status: 204, headers: { "set-cookie": clearSession() } });
  }

  return { currentMember, beginLogin, completeLogin, logout };
}
