import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Root flat config. Every package's `eslint.config.js` re-exports this and appends its own
 * overrides (for example the browser globals and react-hooks in the web app).
 *
 * Type-aware (`strictTypeChecked` with `projectService`), so lint catches what `tsc` does not:
 * floating promises, unsafe `any` flows, needless conditions.
 *
 * The size/shape rules (`complexity`, `max-lines`, `max-depth`) are the per-function / per-file
 * guard rails.
 */
export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**", "assets/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
      parserOptions: {
        projectService: { allowDefaultProject: ["vitest.config.ts"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      complexity: ["error", 15],
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-depth": ["error", 4],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-var": "error",
    },
  },
  {
    // Plain JS (configs) is not part of any tsconfig project, so type-aware rules cannot run.
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
);
