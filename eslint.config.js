import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "drizzle", "migrations", ".wrangler", "worker-configuration.d.ts"] },
  ...tseslint.configs.recommended,
);
