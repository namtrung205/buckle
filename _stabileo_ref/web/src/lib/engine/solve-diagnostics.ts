/**
 * solve-diagnostics.ts — shared post-solve reliability reporting.
 *
 * Extracted from `live-calc.ts` so Education can reuse it instead of growing a
 * second copy. Education previously discarded every severity-`warning`
 * diagnostic the solver produced and never ran the non-finite displacement
 * gate that all three Basic solve paths run, which meant a degenerate result
 * could be used to grade a student's answers.
 *
 * This module reports; it never decides what a solve means and never touches
 * numerics.
 */

import { uiStore } from '../store/ui.svelte';
import { t } from '../i18n';
import type { SolverDiagnostic } from './types';

/** Max diagnostics surfaced at once, so a noisy model cannot bury the UI. */
const MAX_TOASTS = 2;

/**
 * Surface solver warnings/errors as toasts.
 *
 * Diagnostic messages may be i18n keys or already-localized text; `t()` returns
 * its input unchanged when there is no matching key, so both work.
 */
export function reportSolverDiagnostics(diags?: SolverDiagnostic[]): void {
  if (!diags) return;
  const important = diags.filter((d) => d.severity === 'error' || d.severity === 'warning');
  for (const d of important.slice(0, MAX_TOASTS)) {
    const msg = t(d.message) !== d.message ? t(d.message) : d.message;
    uiStore.toast(msg, d.severity === 'error' ? 'error' : 'info');
  }
}
