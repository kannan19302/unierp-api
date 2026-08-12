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

// L03 — CODE_STANDARDS § 6.1: "no catch that swallows, no `catch {}`, no
// re-throw that loses the cause." Two custom rules, syntax-only (no type
// information needed, unlike L02's boolean-naming rule) so they run fast
// across the whole repo.
const noSwallowedCatchRule = {
  meta: {
    type: "problem",
    docs: { description: "A catch block must not silently swallow the error — CODE_STANDARDS § 6.1" },
    schema: [],
  },
  create(context) {
    return {
      CatchClause(node) {
        const body = node.body.body;
        if (body.length === 0) return; // no-empty already covers this
        const paramName = node.param && node.param.type === "Identifier" ? node.param.name : null;
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const bodyText = sourceCode.getText(node.body);
        // "References the caught error somewhere in the block" is a
        // conservative, syntax-only proxy for "does something with it"
        // (handles it, wraps it, logs it, rethrows it). A block that
        // never mentions the parameter at all — regardless of what else
        // it does — has thrown the evidence away, exactly what § 6.1
        // forbids.
        if (paramName && !new RegExp(`\\b${paramName}\\b`).test(bodyText.slice(bodyText.indexOf("{") + 1))) {
          context.report({ node, message: `catch block never references its caught error parameter "${paramName}" — the error is handled without ever being examined, effectively swallowed (CODE_STANDARDS § 6.1)` });
        }
      },
    };
  },
};

const noCauseLossRethrowRule = {
  meta: {
    type: "problem",
    docs: { description: "A rethrow inside a catch must preserve the original error as `cause` — CODE_STANDARDS § 6.1" },
    schema: [],
  },
  create(context) {
    return {
      CatchClause(node) {
        if (!node.param || node.param.type !== "Identifier") return;
        const paramName = node.param.name;
        for (const stmt of node.body.body) {
          if (stmt.type !== "ThrowStatement") continue;
          const arg = stmt.argument;
          // `throw err;` (rethrowing the same object) always preserves it — fine.
          if (arg.type === "Identifier" && arg.name === paramName) continue;
          // `throw new SomeError(..., { cause: err })` — must pass an
          // options object containing a `cause` property.
          if (arg.type === "NewExpression" || arg.type === "CallExpression") {
            const lastArg = arg.arguments[arg.arguments.length - 1];
            const hasCauseOption =
              lastArg &&
              lastArg.type === "ObjectExpression" &&
              lastArg.properties.some((p) => p.type === "Property" && p.key.type === "Identifier" && p.key.name === "cause");
            if (!hasCauseOption) {
              context.report({ node: stmt, message: `rethrow inside a catch must pass the original error as { cause } — this one constructs a new error with no cause option, losing "${paramName}" (CODE_STANDARDS § 6.1)` });
            }
            continue;
          }
          // Any other throw shape (a string, a bare object literal, etc.)
          // is also a cause-losing rethrow.
          context.report({ node: stmt, message: `rethrow inside a catch loses the original error "${paramName}" — throw it directly, or wrap it with { cause: ${paramName} } (CODE_STANDARDS § 6.1)` });
        }
      },
    };
  },
};

const codeStandardsPlugin = {
  rules: {
    "no-swallowed-catch": noSwallowedCatchRule,
    "no-cause-loss-rethrow": noCauseLossRethrowRule,
  },
};

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "test/**"],
  },
  {
    // L03's rules are syntax-only (no type information needed) — this
    // block deliberately has NO `projectService`, so it can run across
    // the whole repo without building a TypeScript type program per
    // file. L02's block below adds type-aware parserOptions, but ONLY
    // for the narrower scope it actually needs — merging that into THIS
    // broad block was tried and OOMs even with the type-aware rule
    // itself disabled via a CLI --rule override, because
    // `projectService: true` builds the type program for every matched
    // file regardless of which rules are active.
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "code-standards": codeStandardsPlugin,
    },
    rules: {
      // L03 — CODE_STANDARDS § 6.1.
      "no-empty": ["warn", { allowEmptyCatch: false }],
      "code-standards/no-swallowed-catch": "warn",
      "code-standards/no-cause-loss-rethrow": "warn",
    },
  },
  {
    // L02 — CODE_STANDARDS § 3, the boolean-prefix naming rule
    // specifically needs real type information. Scoped to a single
    // module by necessity (see L02's own evidence file): type-aware
    // linting OOMs across the full repo even at an 8GB heap, and this
    // glob must NOT overlap "src/**/*.ts" or every file would trigger
    // type-program construction again regardless of the block above.
    files: ["src/modules/admin/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
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
