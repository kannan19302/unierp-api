#!/usr/bin/env node
// L13 (Track L — code quality): "*.coverage.spec.ts no longer excluded when
// process.env.CI — the whole suite runs everywhere it runs." Exit:
// "vitest.config.ts has an identical exclude list in CI and locally. The
// CI test count equals the local test count, asserted."
//
// Spawns two fresh Node subprocesses to import vitest.config.ts — one with
// CI=true, one with CI unset — and asserts the resolved test.exclude array
// is byte-identical between them. A real assertion, not a visual read of
// the source: if someone reintroduces `process.env.CI ? [...] : [...]`,
// this fails immediately, in both directions.
//
//   node scripts/check-ci-test-parity.mjs

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(root, 'vitest.config.ts').replace(/\\/g, '/');

function resolveExcludeIn(envCI) {
  const script = `
    import('${'file:///' + CONFIG_PATH}').then((mod) => {
      console.log(JSON.stringify(mod.default.test.exclude));
    });
  `;
  const env = { ...process.env };
  if (envCI) env.CI = 'true';
  else delete env.CI;
  const out = execFileSync('node', ['--input-type=module', '-e', script], {
    cwd: root,
    env,
    encoding: 'utf-8',
  });
  return JSON.parse(out.trim());
}

const ciExclude = resolveExcludeIn(true);
const localExclude = resolveExcludeIn(false);

console.log(`CI (CI=true) exclude:    ${JSON.stringify(ciExclude)}`);
console.log(`Local (CI unset) exclude: ${JSON.stringify(localExclude)}`);

if (JSON.stringify(ciExclude) !== JSON.stringify(localExclude)) {
  console.error('FAIL  vitest.config.ts test.exclude differs between CI and local — the whole suite does NOT run everywhere it runs.');
  process.exit(1);
}

if (ciExclude.some((p) => /coverage\.spec/.test(p))) {
  console.error('FAIL  test.exclude still filters out *.coverage.spec.ts — L11/L12/L13\'s own subject files would never run anywhere.');
  process.exit(1);
}

console.log('OK    test.exclude is identical in CI and locally, and does not filter out *.coverage.spec.ts.');
process.exit(0);
