/**
 * Every `--st-*` a component references must actually be defined.
 *
 * # The failure mode this closes
 *
 * An undefined custom property does not error and does not fall back. It makes
 * the whole declaration invalid, so `border: 1px solid var(--st-border)` with
 * no `--st-border` defined simply draws no border — silently, in one component,
 * while the ones around it look fine.
 *
 * That is exactly what happened: `--st-border` was written 23 times across six
 * components and defined nowhere. The section picker's preview card lost its
 * edge while the drawing inside it kept a hardcoded blue box, and the panel got
 * reported as "untidy" three times without anyone finding a cause, because
 * there was nothing to find in the component — the defect was an absence
 * somewhere else.
 *
 * A typo in a token name fails the same way and is just as invisible. So this
 * checks the whole surface rather than any one panel.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');
const TOKENS = join(SRC, 'styles', 'tokens.css');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue;
      walk(p, out);
    } else if (/\.(svelte|css)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** Token names defined anywhere in the stylesheet, including inside media queries. */
function definedTokens(): Set<string> {
  const css = readFileSync(TOKENS, 'utf8');
  return new Set([...css.matchAll(/(--st-[\w-]+)\s*:/g)].map((m) => m[1]));
}

/**
 * Token names referenced through `var()` WITHOUT a fallback.
 *
 * `var(--st-radius, 3px)` is fine whether or not the token exists — the author
 * said what to do if it does not. `var(--st-radius)` alone is a promise that it
 * does, and that is the promise checked here. Same for properties set from
 * script, like the panel width App writes inline: those carry a fallback
 * precisely because the stylesheet is not where they come from.
 */
function referencedTokens(): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/var\(\s*(--st-[\w-]+)\s*\)/g)) {
      const where = refs.get(m[1]) ?? [];
      where.push(file.slice(SRC.length + 1));
      refs.set(m[1], where);
    }
  }
  return refs;
}

describe('design tokens', () => {
  it('every referenced token is defined', () => {
    const defined = definedTokens();
    const missing: string[] = [];
    for (const [token, files] of referencedTokens()) {
      if (!defined.has(token)) {
        missing.push(`${token} — used in ${[...new Set(files)].join(', ')}`);
      }
    }
    expect(missing, `undefined design tokens:\n${missing.join('\n')}`).toEqual([]);
  });

  it('the stylesheet defines the tokens the app is built on', () => {
    // A guard on the guard: if the parse ever stops finding definitions, the
    // test above would pass vacuously by declaring everything missing — or, if
    // the reference parse broke instead, by checking nothing at all.
    const defined = definedTokens();
    expect(defined.size).toBeGreaterThan(20);
    for (const core of ['--st-bg', '--st-surface', '--st-text', '--st-accent', '--st-border']) {
      expect(defined.has(core), `${core} must be defined`).toBe(true);
    }
    expect(referencedTokens().size).toBeGreaterThan(20);
  });
});
