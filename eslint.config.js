import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";

const compat = new FlatCompat();

export default [
  js.configs.recommended,
  {
    rules: {
      semi: ["error", "always"],
      quotes: ["error", "double"],
    },
  },
  ...compat.config({
    // Add your ESLint config from .eslintrc.json here
    extends: ["plugin:prettier/recommended"],
    parserOptions: {
      ecmaVersion: 12,
      sourceType: "module",
    },
  }),
];
