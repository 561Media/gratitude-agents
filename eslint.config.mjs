import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "output/**",
      "hub/**",
      "brand-kit/**",
      "brandguide/**",
      "design-kit/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // lib/slides.ts is being rewritten on the output-quality branch; its one
    // pre-existing prefer-const error is downgraded here to avoid a merge
    // conflict. Remove this override once that branch lands.
    files: ["lib/slides.ts"],
    rules: { "prefer-const": "warn" },
  },
];

export default eslintConfig;
