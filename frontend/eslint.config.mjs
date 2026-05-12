import path from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/** ESLint 9 flat config + Next.js core-web-vitals (Vercel-safe ESM resolution). */
export default [
  {
    ignores: [".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
  ...compat.extends("next/core-web-vitals"),
  {
    rules: {
      // Project copy uses apostrophes/quotes in JSX; blocking Vercel builds is not worth the churn.
      "react/no-unescaped-entities": "off",
      // Prefer warnings until images are migrated to next/image.
      "@next/next/no-img-element": "warn",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
