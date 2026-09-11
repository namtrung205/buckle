import type {
  CommandContribution,
  ContextMenuContribution,
  ContributionBundle,
  ContributionOwner,
  OwnedContribution,
  PanelContribution,
  RibbonContribution,
  RibbonTabContribution,
} from './types.ts'

type StoredBundle = Readonly<{
  owner: ContributionOwner
  commandIds: readonly string[]
  tabIds: readonly string[]
  ribbonIds: readonly string[]
  contextMenuIds: readonly string[]
  panelIds: readonly string[]
}>

const idPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const ownerKey = (owner: ContributionOwner) => `${owner.kind}:${owner.id}`
const byOrderAndId = <T extends { id: string; order?: number }>(a: T, b: T) =>
  (a.order ?? 1_000) - (b.order ?? 1_000) || a.id.localeCompare(b.id)

export class ContributionRegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContributionRegistryError'
  }
}

export class ContributionRegistry {
  private readonly owners = new Map<string, StoredBundle>()
  private readonly commands = new Map<string, OwnedContribution<CommandContribution>>()
  private readonly tabs = new Map<string, OwnedContribution<RibbonTabContribution>>()
  private readonly ribbon = new Map<string, OwnedContribution<RibbonContribution>>()
  private readonly contextMenus = new Map<string, OwnedContribution<ContextMenuContribution>>()
  private readonly panels = new Map<string, OwnedContribution<PanelContribution>>()
  private readonly listeners = new Set<() => void>()
  private revision = 0
  private activePanelId: string | null = null

  getSnapshot = () => this.revision
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  register(owner: ContributionOwner, bundle: ContributionBundle): () => void {
    this.validateOwner(owner)
    const key = ownerKey(owner)
    if (this.owners.has(key)) throw new ContributionRegistryError(`Contribution owner ${owner.id} is already registered`)

    const commands = [...(bundle.commands ?? [])]
    const tabs = [...(bundle.ribbonTabs ?? [])]
    const ribbon = [...(bundle.ribbon ?? [])]
    const contextMenus = [...(bundle.contextMenus ?? [])]
    const panels = [...(bundle.panels ?? [])]
    this.validateUnique(commands, this.commands, owner, 'command')
    this.validateUnique(tabs, this.tabs, owner, 'ribbon tab')
    this.validateUnique(ribbon, this.ribbon, owner, 'ribbon contribution')
    this.validateUnique(contextMenus, this.contextMenus, owner, 'context-menu contribution')
    this.validateUnique(panels, this.panels, owner, 'panel contribution')

    const availableCommands = new Set([...this.commands.keys(), ...commands.map(value => value.id)])
    const availableTabs = new Set([...this.tabs.keys(), ...tabs.map(value => value.id)])
    for (const item of ribbon) {
      if (!availableCommands.has(item.commandId)) throw new ContributionRegistryError(`Ribbon ${item.id} references unknown command ${item.commandId}`)
      if (!availableTabs.has(item.tabId)) throw new ContributionRegistryError(`Ribbon ${item.id} references unknown tab ${item.tabId}`)
      this.assertSameOwnerReference(owner, item.commandId, commands, this.commands, 'command')
    }
    for (const item of contextMenus) {
      if (!availableCommands.has(item.commandId)) throw new ContributionRegistryError(`Context menu ${item.id} references unknown command ${item.commandId}`)
      this.assertSameOwnerReference(owner, item.commandId, commands, this.commands, 'command')
    }

    commands.forEach(value => this.commands.set(value.id, Object.freeze({ ...value, owner })))
    tabs.forEach(value => this.tabs.set(value.id, Object.freeze({ ...value, owner })))
    ribbon.forEach(value => this.ribbon.set(value.id, Object.freeze({ ...value, owner })))
    contextMenus.forEach(value => this.contextMenus.set(value.id, Object.freeze({ ...value, owner })))
    panels.forEach(value => this.panels.set(value.id, Object.freeze({ ...value, owner })))
    this.owners.set(key, Object.freeze({
      owner,
      commandIds: commands.map(value => value.id),
      tabIds: tabs.map(value => value.id),
      ribbonIds: ribbon.map(value => value.id),
      contextMenuIds: contextMenus.map(value => value.id),
      panelIds: panels.map(value => value.id),
    }))
    this.changed()

    let active = true
    return () => {
      if (!active) return
      active = false
      this.unregister(owner)
    }
  }

  unregister(owner: ContributionOwner) {
    const stored = this.owners.get(ownerKey(owner))
    if (!stored) return false
    stored.commandIds.forEach(id => this.commands.delete(id))
    stored.tabIds.forEach(id => this.tabs.delete(id))
    stored.ribbonIds.forEach(id => this.ribbon.delete(id))
    stored.contextMenuIds.forEach(id => this.contextMenus.delete(id))
    stored.panelIds.forEach(id => this.panels.delete(id))
    if (this.activePanelId && stored.panelIds.includes(this.activePanelId)) this.activePanelId = null
    this.owners.delete(ownerKey(owner))
    this.changed()
    return true
  }

  listRibbonTabs() { return [...this.tabs.values()].sort(byOrderAndId) }
  listRibbon(tabId?: string) {
    return [...this.ribbon.values()]
      .filter(item => !tabId || item.tabId === tabId)
      .sort((a, b) => (a.groupOrder ?? 1_000) - (b.groupOrder ?? 1_000) || byOrderAndId(a, b))
  }
  listContextMenus() { return [...this.contextMenus.values()].sort(byOrderAndId) }
  listPanels() { return [...this.panels.values()].sort(byOrderAndId) }
  getActivePanel() { return this.activePanelId ? this.panels.get(this.activePanelId) : undefined }
  getCommand(id: string) { return this.commands.get(id) }

  openPanel(id: string) {
    if (!this.panels.has(id)) throw new ContributionRegistryError(`Unknown contribution panel ${id}`)
    if (this.activePanelId === id) return
    this.activePanelId = id
    this.changed()
  }

  closePanel(id?: string) {
    if (!this.activePanelId || (id && this.activePanelId !== id)) return false
    this.activePanelId = null
    this.changed()
    return true
  }

  async invokeCommand(id: string) {
    const command = this.commands.get(id)
    if (!command) throw new ContributionRegistryError(`Unknown contribution command ${id}`)
    await command.execute()
  }

  private validateOwner(owner: ContributionOwner) {
    if (!idPattern.test(owner.id)) throw new ContributionRegistryError(`Invalid contribution owner id ${owner.id}`)
    if (!semverPattern.test(owner.version)) throw new ContributionRegistryError(`Invalid contribution owner version ${owner.version}`)
  }

  private validateUnique<T extends { id: string }>(
    values: readonly T[],
    existing: ReadonlyMap<string, unknown>,
    owner: ContributionOwner,
    label: string,
  ) {
    const seen = new Set<string>()
    for (const value of values) {
      if (!idPattern.test(value.id)) throw new ContributionRegistryError(`Invalid ${label} id ${value.id}`)
      if (owner.kind === 'plugin' && !value.id.startsWith(`${owner.id}.`)) {
        throw new ContributionRegistryError(`Plugin ${label} id ${value.id} must be namespaced by ${owner.id}.`)
      }
      if (seen.has(value.id) || existing.has(value.id)) throw new ContributionRegistryError(`Duplicate ${label} id ${value.id}`)
      seen.add(value.id)
    }
  }

  private assertSameOwnerReference<T extends { id: string }>(
    owner: ContributionOwner,
    id: string,
    incoming: readonly T[],
    existing: ReadonlyMap<string, { owner: ContributionOwner }>,
    label: string,
  ) {
    if (incoming.some(item => item.id === id)) return
    const target = existing.get(id)
    if (!target || ownerKey(target.owner) !== ownerKey(owner)) {
      throw new ContributionRegistryError(`${owner.id} cannot reference a ${label} owned by another contribution owner`)
    }
  }

  private changed() {
    this.revision++
    this.listeners.forEach(listener => listener())
  }
}
