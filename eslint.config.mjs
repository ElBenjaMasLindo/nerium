import strict from "sadist/config/strict";
import tsParser from "@typescript-eslint/parser";

export default [
  ...strict,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
    },
  },
];
