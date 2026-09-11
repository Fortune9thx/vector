import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = [
  {
    // Auto-generated output and types: Next.js writes next-env.d.ts (which
    // uses triple-slash references by design) and .next/ build artifacts --
    // none of it is hand-authored, so none of it is linted.
    ignores: ["next-env.d.ts", ".next/**"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
