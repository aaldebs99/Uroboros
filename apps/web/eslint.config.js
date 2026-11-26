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
    // vi.waitFor gives up after vitest's 1 s, which a loaded CI runner misses; testing-library's
    // waitFor takes the suite's wait (src/test/setup.ts) and wraps its checks in act.
    files: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "vi",
          property: "waitFor",
          message: "Use waitFor from @testing-library/react: it waits the suite's 5 s.",
        },
      ],
    },
  },
  {
    // Plain scripts served as they are (the pre-paint theme script): browser globals.
    files: ["public/**/*.js"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["*.config.{js,ts}", "src/test/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
];
