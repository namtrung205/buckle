/**
 * The four ways a structure gets into an exercise.
 *
 * "Take what is drawn" assumed there was something drawn. Switching from Basic
 * to Educational does not carry the model across, so a teacher who had just
 * built a frame arrived at an empty canvas with no way back — the button was
 * not wrong, it was the only door in a room that needs four.
 *
 * Every route can fail in its own way, and each failure has to produce a
 * sentence a teacher can act on rather than a silent no-op. That is what is
 * checked here, along with the routes existing at all.
 */

import { describe, it, expect } from 'vitest';
import { EXERCISE_EXAMPLES, fromShareUrl } from '../exercise-source';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const author = readFileSync(join(process.cwd(), 'src/components/edu/ExerciseAuthor.svelte'), 'utf8');

describe('all four routes are offered', () => {
  it('the panel presents draw, example, file and link', () => {
    for (const key of ['srcDraw', 'srcExample', 'srcFile', 'srcLink']) {
      expect(author, `missing ${key}`).toContain(`edu.author.${key}`);
    }
  });

  it('each route ends in the same capture step', () => {
    // Whatever the source, the structure has to be read the same way — four
    // routes producing four slightly different specs would be a maintenance
    // trap and a source of subtle differences between exercises.
    expect(author).toMatch(/useExample[\s\S]{0,400}capture\(\)/);
    expect(author).toMatch(/useFile[\s\S]{0,400}capture\(\)/);
    expect(author).toMatch(/useLink[\s\S]{0,300}capture\(\)/);
  });

  it('the draw route says why the canvas may be empty', () => {
    // The specific confusion that prompted this: the model does not travel
    // between modes, and nothing on screen said so.
    expect(author).toContain('edu.author.nothingDrawn');
  });
});

describe('the example list is usable for teaching', () => {
  it('offers a spread from single beams to frames', () => {
    const ids = EXERCISE_EXAMPLES.map((e) => e.id);
    expect(ids).toContain('simply-supported');
    expect(ids).toContain('cantilever');
    expect(ids).toContain('truss');
    expect(ids).toContain('portal-frame');
    expect(EXERCISE_EXAMPLES.length).toBeGreaterThanOrEqual(8);
  });

  it('every entry has an id and a translation key', () => {
    for (const e of EXERCISE_EXAMPLES) {
      expect(e.id, 'id').toBeTruthy();
      expect(e.nameKey.startsWith('ex.'), `${e.id} key`).toBe(true);
    }
  });
});

describe('a bad link is named, not silently ignored', () => {
  it('an empty link asks for one', () => {
    expect(fromShareUrl('   ')).toEqual({ ok: false, error: 'errEmptyLink' });
  });

  it('a URL that is not a share link says exactly that', () => {
    // Pasting the plain app URL, or somebody else's link, is the likely
    // mistake — and it must not look like it worked.
    const r = fromShareUrl('https://stabileo.com/');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('errNotShareLink');
  });

  it('a share link with damaged payload reports rather than throwing', () => {
    const r = fromShareUrl('https://stabileo.com/#data=@@@not-valid@@@');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(['errLinkBroken', 'errNotShareLink']).toContain(r.error);
  });
});

describe('every error the sources can raise has a message', () => {
  it('each error code is translated in both locales', () => {
    // An untranslated code would surface to a teacher as `edu.author.errNotDed`,
    // which is worse than no message at all.
    const codes = ['errExample', 'errFileRead', 'errNotDed', 'errEmptyLink', 'errNotShareLink', 'errLinkBroken'];
    for (const loc of ['es', 'en']) {
      const dict = readFileSync(join(process.cwd(), `src/lib/i18n/locales/${loc}.ts`), 'utf8');
      for (const c of codes) {
        expect(dict, `${loc} missing ${c}`).toContain(`'edu.author.${c}'`);
      }
    }
  });
});
