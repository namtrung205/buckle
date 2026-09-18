export type ContributionOwner = Readonly<{
  kind: 'builtin' | 'plugin'
  id: string
  version: string
}>

export type HostPredicate =
  | 'modelLocked' | 'modelUnlocked' | 'hasResults' | 'hasSelection'
  | 'hasNodeSelection' | 'hasMemberSelection' | 'hasShellSelection'
  | 'selectionModeNode' | 'selectionModeMember' | 'selectionModeShell'

export type ContributionIcon =
  | Readonly<{ kind: 'asset'; src: string; alt: string; size?: number }>
  | Readonly<{ kind: 'host'; name: string }>

export type CommandContribution = Readonly<{
  id: string
  title: string
  execute: () => void | Promise<void>
}>

export type RibbonTabContribution = Readonly<{
  id: string
  label: string
  order?: number
  enabledWhen?: readonly HostPredicate[]
  visibleWhen?: readonly HostPredicate[]
}>

export type RibbonContribution = Readonly<{
  id: string
  tabId: string
  groupId: string
  groupLabel: string
  groupOrder?: number
  order?: number
  commandId: string
  label: string
  labelWhen?: Partial<Record<HostPredicate, string>>
  title?: string
  titleWhen?: Partial<Record<HostPredicate, string>>
  icon?: ContributionIcon
  enabledWhen?: readonly HostPredicate[]
  visibleWhen?: readonly HostPredicate[]
  activeWhen?: readonly HostPredicate[]
}>

export type ContextMenuContribution = Readonly<{
  id: string
  commandId: string
  label: string
  order?: number
  icon?: ContributionIcon
  danger?: boolean
  enabledWhen?: readonly HostPredicate[]
  visibleWhen?: readonly HostPredicate[]
}>

export type PanelContribution = Readonly<{
  id: string
  title: string
  entry: string
  order?: number
}>

export type ContributionBundle = Readonly<{
  commands?: readonly CommandContribution[]
  ribbonTabs?: readonly RibbonTabContribution[]
  ribbon?: readonly RibbonContribution[]
  contextMenus?: readonly ContextMenuContribution[]
  panels?: readonly PanelContribution[]
}>

export type OwnedContribution<T> = Readonly<T & { owner: ContributionOwner }>
