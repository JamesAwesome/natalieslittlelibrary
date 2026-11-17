import type { Identity, IdentityProvider } from "./index";

export function fakeProvider(result: Identity | Error): IdentityProvider {
  return {
    authorizationUrl: async (state) => new URL(`https://idp.test/auth?state=${encodeURIComponent(state)}`),
    exchange: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}
