import js from "@eslint/js";
import importX from "eslint-plugin-import-x";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/*.d.ts",
      "**/node_modules/**",
      "**/*.tsbuildinfo",
      "prototype/**",
      "ops/**",
      "docs/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "import-x": importX },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "import-x/order": ["warn", { "newlines-between": "always", alphabetize: { order: "asc" } }],
    },
  },
  {
    // Library/server source: named exports only (keeps refactors + tree-shaking honest).
    files: ["packages/**/*.ts", "apps/server/**/*.ts", "mcp/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: { "import-x/no-default-export": "error" },
  },
  {
    // Config + test files may default-export.
    files: ["**/*.config.{js,ts}", "**/*.test.ts", "eslint.config.js"],
    rules: { "import-x/no-default-export": "off" },
  },
);
