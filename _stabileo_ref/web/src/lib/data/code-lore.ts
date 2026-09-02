/**
 * code-lore.ts — where each design code comes from, and why it is the way it is.
 *
 * A dropdown listing twenty-two codes tells a student nothing about which world
 * they are stepping into. These are the sentences a colleague would say: who
 * writes it, roughly when, and the one fact that explains the rest — why CIRSOC
 * reads like AISC, why Eurocode has national annexes at all, why the American
 * concrete code is numbered 318.
 *
 * # Why this file holds no prose
 *
 * The first version did, in English, and shipped straight to a Spanish user as
 * English text. Data modules are the easiest place for that to happen: nothing
 * here renders, so there is no `t()` call nearby to remind you, and a literal
 * string looks like data rather than like copy. It is copy.
 *
 * So this maps a code to a stable id and the translations live where every
 * other string lives. The id is derived from the code's display name — that is
 * what the picker has in hand, since the metals resolve an id and the
 * non-metals carry a name, and this has to serve both.
 */

import { t } from '../i18n';

export interface CodeLore {
  /** Body that writes and maintains it. */
  body: string;
  /** When it appeared, or the edition in use. */
  since: string;
  /** The fact that makes the rest make sense. */
  trivia: string;
}

/**
 * Codes with lore written for them, as translation-key stems.
 *
 * A set rather than a map of prose: the only thing this file needs to know is
 * WHICH codes have an entry. What the entry says is not its business.
 */
const KNOWN = new Set([
  'cirsoc-301-2005', 'aisc-360-16', 'aisc-360-22', 'en-1993-1-1-2005', 'nbr-8800-2008',
  'cirsoc-303-2009', 'aisi-s100-16', 'en-1993-1-3-2006', 'nbr-14762-2010',
  'en-1999-1-1-2007', 'adm-2020', 'cirsoc-701-2010',
  'en-1993-1-4-2006', 'aisc-design-guide-27',
  'cirsoc-201', 'en-1992-1-1', 'aci-318', 'nbr-6118',
  'en-338',
]);

/**
 * Slug a display name into the key stem.
 *
 * "CIRSOC 301:2005" → "cirsoc-301-2005". Derived rather than tabulated so a
 * code cannot be listed in one place and looked up under another spelling.
 */
function stem(name: string): string {
  return name
    .toLowerCase()
    .replace(/[:.]/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Lore for a code, by display name. Null when none is written — which is a real
 * state and not a gap: the picker simply omits the `?` rather than showing an
 * empty bubble.
 */
export function codeLore(name: string | undefined): CodeLore | null {
  if (!name) return null;
  const id = stem(name);
  if (!KNOWN.has(id)) return null;
  return {
    body: t(`lore.${id}.body`),
    since: t(`lore.${id}.since`),
    trivia: t(`lore.${id}.trivia`),
  };
}
