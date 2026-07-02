import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import node from "eslint-plugin-n";

export default [
  {
    ignores: ["dist/**", "coverage/**"],
  },
  node.configs["flat/recommended"],
  {
    languageOptions: {
      globals: {
        ...globals.builtin,
        ...globals.node,
        AbortController: "readonly",
        AbortSignal: "readonly",
        EventTarget: "readonly",
        CustomEvent: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      curly: "error",
      "block-scoped-var": "error",
      eqeqeq: "error",
      "guard-for-in": "error",
      "no-alert": "error",
      "no-caller": "error",
      "no-console": "off",
      "no-else-return": "error",
      "no-extend-native": "error",
      "no-extra-boolean-cast": "off",
      "no-lonely-if": "error",
      "no-loop-func": "error",
      "no-new": "error",
      "no-var": "error",
      "no-prototype-builtins": "off",
      "no-sequences": "error",
      "no-undef-init": "error",
      "no-restricted-globals": ["error", "fdescribe", "fit"],
      "no-unused-expressions": "error",
      "no-useless-escape": "off",
      "prefer-const": "error",
      "prefer-template": "error",
      "require-atomic-updates": "off",
      strict: "error",
      "wrap-iife": ["error", "any"],
      "no-unused-vars": ["warn", { args: "none" }],
      "new-cap": "off",
      "no-use-before-define": "off",
      "n/global-require": "error",
      "n/no-new-require": "error",
      "n/no-unsupported-features/node-builtins": "off",
      "n/no-process-exit": "off",
      "n/no-unsupported-features/es-syntax": [
        "error",
        {
          // Without setting this the error for preserve-caught-error from eslint/js cannot be fixed
          version: ">=20.0.0",
          ignores: [],
        },
      ],
      // strippable TS quirk; you need to have separate imports for types versus values
      "no-duplicate-imports": "off",
      // strippable TS quirk; you need to const X = {}; type X = (typeof X)[keyof typeof X]; for enum-like behavior.
      "no-redeclare": "off",
    },
    files: [
      "packages/*/src/**/*.{ts,js}",
    ],
  },
  {
    files: ["eslint.config.mjs"],
    rules: {
      "n/no-unpublished-import": "off"
    }
  }
];
