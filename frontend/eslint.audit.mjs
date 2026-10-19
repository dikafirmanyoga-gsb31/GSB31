import reactHooks from "eslint-plugin-react-hooks";
import react from "eslint-plugin-react";
import globals from "globals";
export default [{ files: ["src/**/*.{js,jsx}"], ignores: ["src/components/ui/**"],
  languageOptions: { ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } }, globals: { ...globals.browser, process: "readonly" } },
  plugins: { "react-hooks": reactHooks, react },
  settings: { react: { version: "19" } },
  rules: { "react-hooks/exhaustive-deps": "warn", "react-hooks/rules-of-hooks": "error", "no-undef": "error", "react/jsx-key": "warn", "react/jsx-no-undef": "error", "react/jsx-uses-vars": "error", "react/jsx-uses-react": "error", "no-unused-vars": "warn" } }];
