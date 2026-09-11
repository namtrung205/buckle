import type { HostPredicate } from './types.ts'

export type ContributionHostState = Readonly<Record<HostPredicate, boolean>>

export const matchesPredicates = (
  predicates: readonly HostPredicate[] | undefined,
  state: ContributionHostState,
) => !predicates || predicates.every(predicate => state[predicate])

