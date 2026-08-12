// L02 (Track L — code quality): "@typescript-eslint/naming-convention
// encoding CODE_STANDARDS § 3." This is the first working ESLint config
// this repo has ever had — `npm run lint` referenced a config file that
// did not exist anywhere in the repo, so lint never actually ran (an
// unpinned `npx eslint` install confirmed "ESLint couldn't find an
// eslint.config.(js|mjs|cjs) file" before this file existed).
//
// Only the genuinely MECHANICAL rules from CODE_STANDARDS § 3 are encoded
// here — the ones a naming-convention selector can actually check.
// Semantic rules ("say what it is, not what it's made of", "use the
// business's vocabulary") cannot be machine-checked and are left to
// review, as CODE_STANDARDS § 10 itself requires stating explicitly
// rather than silently claiming coverage that isn't real.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "test/**"],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        // The boolean-prefix rule below needs real type information to
        // tell a boolean variable apart from any other — this is real
        // type-aware linting, not a syntax-only heuristic.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/naming-convention": [
        "warn",
        // § 3 "Booleans read as assertions": boolean variables/properties
        // must start with is/has/can/should/did/will — not `flag`,
        // `status`, `check`.
        {
          selector: ["variable", "classProperty", "parameterProperty"],
          types: ["boolean"],
          format: ["camelCase"],
          prefix: ["is", "has", "can", "should", "did", "will"],
          leadingUnderscore: "allow",
        },
        // § 3 "No Hungarian, no type suffixes": interfaces must not be
        // prefixed with `I` (the single most common Hungarian-notation
        // violation this rule set targets).
        {
          selector: "interface",
          format: ["PascalCase"],
          custom: {
            regex: "^I[A-Z]",
            match: false,
          },
        },
        // Classes and type aliases: PascalCase.
        {
          selector: ["class", "typeAlias", "enum"],
          format: ["PascalCase"],
        },
        // True module-level constants (`const ALGORITHM = "aes-256-gcm"`)
        // conventionally use UPPER_CASE — not addressed explicitly by § 3,
        // but standard practice this codebase already follows in places;
        // this selector must come BEFORE the general camelCase rule below
        // so it wins for global const bindings specifically.
        {
          selector: "variable",
          modifiers: ["const", "global"],
          format: ["camelCase", "UPPER_CASE"],
        },
        // Standard variable/function/parameter casing.
        {
          selector: ["variable", "function", "parameter", "method"],
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
        // Enum members: § 3 says nothing explicit; the codebase's own
        // dominant convention (confirmed by grep across the schema and
        // service layer) is UPPER_CASE for enum-shaped string constants.
        {
          selector: "enumMember",
          format: ["UPPER_CASE", "PascalCase"],
        },
      ],
    },
  },
);
