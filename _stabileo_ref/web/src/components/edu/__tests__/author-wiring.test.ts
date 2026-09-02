/**
 * The authoring panel is actually reachable.
 *
 * This exists because of a real failure: the button was wired, the state
 * flipped, and NOTHING happened — the branch rendering the author sat after
 * `{:else if !hasExercise}`, which is true exactly when the button is on
 * screen, so it could never be reached. No unit test caught it, because every
 * unit involved was correct. Only the arrangement was wrong.
 *
 * Reading the source is a blunt instrument, and it is the right one here: the
 * property is about ORDER, and it is cheap to check and expensive to
 * rediscover in front of a user.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const panel = readFileSync(join(process.cwd(), 'src/components/edu/EducativePanel.svelte'), 'utf8');
const author = readFileSync(join(process.cwd(), 'src/components/edu/ExerciseAuthor.svelte'), 'utf8');

describe('the author panel can be reached', () => {
  it('the authoring branch is tested before the exercise-list branch', () => {
    // The flag moved into the store — the shell mounts the drawing tools off
    // it — so the branch reads `eduStore.authoring`. What this test is about
    // is the ORDER of the two branches, which is unchanged.
    const authoringBranch = panel.indexOf('{#if eduStore.authoring}');
    const listBranch = panel.indexOf('!eduStore.hasExercise');
    expect(authoringBranch, 'authoring must be a branch of its own').toBeGreaterThan(-1);
    expect(listBranch).toBeGreaterThan(-1);
    expect(
      authoringBranch < listBranch,
      'the exercise list renders whenever no exercise is loaded, which is exactly when the ' +
        'author button is visible — so testing it first makes the author unreachable',
    ).toBe(true);
  });

  it('something actually sets authoring to true', () => {
    expect(panel).toMatch(/authoring\s*=\s*true/);
  });

  it('the shell mounts the drawing tools while authoring', () => {
    // The form's default option is "draw the structure with the usual tools".
    // Education renders no ribbon and no toolbar of its own, so if App stops
    // mounting the tool bar for this case that instruction becomes a dead end
    // again — which is exactly how it shipped.
    const app = readFileSync(join(process.cwd(), 'src/App.svelte'), 'utf8');
    expect(app).toMatch(/educativo'\s*&&\s*eduStore\.authoring/);
    expect(app).toMatch(/<FloatingTools \/>/);
  });

  it('the props the panel passes are the props the author declares', () => {
    // The other half of the same failure mode: a renamed prop typechecks in
    // neither direction across a Svelte boundary until it is rendered.
    for (const prop of ['onclose', 'onsaved', 'editing']) {
      expect(author, `author must declare ${prop}`).toMatch(new RegExp(`${prop}[?]?:`));
      expect(panel, `panel must pass ${prop}`).toMatch(new RegExp(`${prop}=`));
    }
  });

  it('the author is imported and rendered, not merely defined', () => {
    expect(panel).toMatch(/import ExerciseAuthor from/);
    expect(panel).toMatch(/<ExerciseAuthor/);
  });
});

describe('the author offers what a teaching mode needs', () => {
  it('covers every question type the exercise format supports', () => {
    // A format richer than its editor is a format nobody uses. Each of these
    // is a section of the panel; losing one silently would make that kind of
    // question unauthorable while still being loadable from a file.
    for (const key of [
      'edu.author.reactions',
      'edu.author.characteristics',
      'edu.author.diagramQuestions',
      'edu.author.shapes',
      'edu.author.kinematic',
      'edu.author.givens',
    ]) {
      expect(author, `missing ${key}`).toContain(key);
    }
  });

  it('offers stress questions, which is what the section engine bought', () => {
    expect(author).toContain('sigmaMax');
    expect(author).toContain('vonMises');
    expect(author).toContain('edu.author.profile');
  });

  it('can save, export and share — three different needs', () => {
    // Library for a teacher's own working set, file for archiving or handing
    // to a colleague, link for handing to a class.
    expect(author).toMatch(/saveToLibrary/);
    expect(author).toMatch(/toFile/);
    expect(author).toMatch(/toShareLink/);
  });

  it('blocks saving while the exercise is invalid', () => {
    expect(author).toMatch(/disabled=\{problems\.length > 0/);
  });
});
