import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

import root from "../../eslint.config.js";

const contractDeepImports = {
  group: ["@uroboros/contract/*"],
  message: "Import from the @uroboros/contract package root only.",
};

/**
 * The web app extends the repo-wide type-aware config with browser globals and react-hooks. Zod
 * stays inside `src/api/`: components consume the inferred contract types, never the schema library.
 */
export default [
  ...root,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "zod", message: "Only src/api/ may import zod." },
            { name: "@hono/zod-openapi", message: "Only src/api/ may import zod." },
          ],
          patterns: [contractDeepImports],
        },
      ],
    },
  },
  {
    files: ["src/api/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: [contractDeepImports] }] },
  },
  {
    files: ["*.config.{js,ts}", "src/test/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
];
