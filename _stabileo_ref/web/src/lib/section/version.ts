/**
 * Version of the persisted canonical section state.
 *
 * Bumped whenever the stored shape changes in a way an older build could
 * misread. `migration.ts` compares a loaded section's stored version against
 * this and re-derives rather than trusting anything it does not recognise.
 *
 * Kept in its own module so both the state layer and the migration layer can
 * import it without a cycle.
 */
export const CANONICAL_STATE_VERSION = 1;
