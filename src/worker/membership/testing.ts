import type { Identity, IdentityProvider } from "./index";

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
