import type { Identity, IdentityProvider } from "./membership";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecodeText(s: string): string {
  const std = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(std + "=".repeat((4 - (std.length % 4)) % 4));
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v !== "";
}

function nonBlankString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

export function googleProvider(opts: {
  clientId: string;
  clientSecret: string;
  siteUrl: string;
  fetch?: typeof fetch;
}): IdentityProvider {
  const doFetch: typeof fetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const redirectUri = new URL("/auth/callback", opts.siteUrl).toString();

  return {
    async authorizationUrl(state, codeVerifier) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
      const url = new URL(AUTH_URL);
      url.search = new URLSearchParams({
        client_id: opts.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        prompt: "select_account",
        state,
        code_challenge: base64UrlEncode(new Uint8Array(digest)),
        code_challenge_method: "S256",
      }).toString();
      return url;
    },

    async exchange(code, codeVerifier): Promise<Identity> {
      const res = await doFetch(TOKEN_URL, {
        method: "POST",
        // Never follow a redirect: that would replay the secret, code and verifier to another URL.
        // workerd has no "error" mode; with "manual" a 3xx is not ok and is refused below.
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: codeVerifier,
        }),
      });
      if (!res.ok) throw new Error(`google token endpoint answered ${res.status}`);

      const body: unknown = await res.json();
      const idToken = (body as { id_token?: unknown } | null)?.id_token;
      if (!nonEmptyString(idToken)) throw new Error("google response has no id_token");

      // The signature is not checked: the token came straight from Google's token
      // endpoint over TLS, which Google documents as sufficient.
      const parts = idToken.split(".");
      if (parts.length !== 3) throw new Error("id_token is malformed");
      const claims: unknown = JSON.parse(base64UrlDecodeText(parts[1]));
      if (typeof claims !== "object" || claims === null || Array.isArray(claims)) {
        throw new Error("id_token payload is not an object");
      }
      const c = claims as Record<string, unknown>;

      if (c.aud !== opts.clientId) throw new Error("id_token audience mismatch");
      if (typeof c.iss !== "string" || !ISSUERS.has(c.iss)) throw new Error("id_token issuer mismatch");
      if (!nonEmptyString(c.sub)) throw new Error("id_token has no sub");
      if (!nonEmptyString(c.email)) throw new Error("id_token has no email");

      return {
        provider: "google",
        subject: c.sub,
        email: c.email,
        emailVerified: c.email_verified === true || c.email_verified === "true",
        // Members see each other's names, never addresses: no part of the email is a fallback.
        name: nonBlankString(c.name) ? c.name : nonBlankString(c.given_name) ? c.given_name : "A reader",
        pictureUrl: nonEmptyString(c.picture) ? c.picture : null,
      };
    },
  };
}
