import { PLUGIN_PERMISSIONS } from '../structural/CommandPolicy.ts'
import type { PluginPermission } from '../structural/CommandPolicy.ts'
import { PLUGIN_SURFACE_PERMISSIONS } from './PluginHostApi.ts'
import type { PluginSessionPermission } from './PluginHostApi.ts'

/** Wire/API version of the plugin sandbox contract (Goal 4). Bumped only for
 *  breaking changes; the manifest negotiates against the supported list. */
export const PLUGIN_API_VERSION = 1
export const SUPPORTED_PLUGIN_API_VERSIONS = [1] as const

const pluginIdPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const KNOWN_PERMISSIONS = new Set<string>([...PLUGIN_PERMISSIONS, ...PLUGIN_SURFACE_PERMISSIONS])

export class ManifestError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ManifestError'
    this.code = code
  }
}

/** Entry points must be relative paths bundled with the plugin, or an https URL
 *  for development loading. Anything else (http:, file:, javascript:, ...) is
 *  rejected — fail closed against remote/off-host code. */
const assertEntry = (value: unknown, field: string) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new ManifestError('INVALID_MANIFEST', `${field} must be a non-empty string of at most 512 characters`)
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith('https://')) {
    throw new ManifestError('INVALID_MANIFEST', `${field} must be a relative path or an https URL (got "${value}")`)
  }
}

/** Declarative contributions (no execute functions — commands are bound to the
 *  sandbox session by the host at enable time). */
export type ManifestContributions = Readonly<{
  commands?: readonly { id: string; title: string }[]
  ribbonTabs?: readonly { id: string; label: string; order?: number }[]
  ribbon?: readonly { id: string; tabId: string; groupId: string; groupLabel: string; commandId: string; label: string; title?: string }[]
  panels?: readonly { id: string; title: string; entry: string }[]
}>

/** Versioned, validated plugin manifest (Goal 4 deliverable). */
export type PluginManifest = Readonly<{
  id: string
  name: string
  version: string
  apiVersion: number
  permissions: readonly PluginSessionPermission[]
  entrypoints: Readonly<{ panel?: string; worker?: string }>
  contributions?: ManifestContributions
  /** Development server URL the host may load the entry from (dev mode only). */
  dev?: Readonly<{ url: string }>
}>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Validate one contribution id against the plugin namespace. */
const assertNamespaced = (ownerId: string, contributionId: unknown, field: string) => {
  if (typeof contributionId !== 'string') throw new ManifestError('INVALID_MANIFEST', `${field}.id must be a string`)
  if (!contributionId.startsWith(`${ownerId}.`)) {
    throw new ManifestError('INVALID_MANIFEST', `${field}.id "${contributionId}" must be namespaced under ${ownerId}.*`)
  }
}

const validateContributions = (ownerId: string, value: unknown): ManifestContributions => {
  if (!isRecord(value)) throw new ManifestError('INVALID_MANIFEST', 'contributions must be an object')
  const unknown = Object.keys(value).filter(key => !['commands', 'ribbonTabs', 'ribbon', 'panels'].includes(key))
  if (unknown.length) throw new ManifestError('INVALID_MANIFEST', `Unknown contributions key(s): ${unknown.join(', ')}`)
  const contributions: Record<string, unknown> = {}
  const list = (key: string, each: (item: Record<string, unknown>) => unknown) => {
    const items = value[key]
    if (items === undefined) return
    if (!Array.isArray(items)) throw new ManifestError('INVALID_MANIFEST', `contributions.${key} must be an array`)
    contributions[key] = items.map(item => {
      if (!isRecord(item)) throw new ManifestError('INVALID_MANIFEST', `contributions.${key}[] must be objects`)
      return each(item)
    })
  }
  list('commands', item => {
    assertNamespaced(ownerId, item.id, 'commands')
    if (typeof item.title !== 'string') throw new ManifestError('INVALID_MANIFEST', 'commands[].title must be a string')
    return { id: item.id, title: item.title }
  })
  list('ribbonTabs', item => {
    assertNamespaced(ownerId, item.id, 'ribbonTabs')
    if (typeof item.label !== 'string') throw new ManifestError('INVALID_MANIFEST', 'ribbonTabs[].label must be a string')
    return item.order === undefined ? { id: item.id, label: item.label } : { id: item.id, label: item.label, order: item.order }
  })
  list('ribbon', item => {
    assertNamespaced(ownerId, item.id, 'ribbon')
    for (const field of ['tabId', 'groupId', 'groupLabel', 'commandId', 'label'] as const) {
      if (typeof item[field] !== 'string') throw new ManifestError('INVALID_MANIFEST', `ribbon[].${field} must be a string`)
    }
    return item.title === undefined
      ? { id: item.id, tabId: item.tabId, groupId: item.groupId, groupLabel: item.groupLabel, commandId: item.commandId, label: item.label }
      : { id: item.id, tabId: item.tabId, groupId: item.groupId, groupLabel: item.groupLabel, commandId: item.commandId, label: item.label, title: item.title }
  })
  list('panels', item => {
    assertNamespaced(ownerId, item.id, 'panels')
    if (typeof item.title !== 'string') throw new ManifestError('INVALID_MANIFEST', 'panels[].title must be a string')
    assertEntry(item.entry, 'panels[].entry')
    return { id: item.id, title: item.title, entry: item.entry }
  })
  return contributions
}

/**
 * Validate an untrusted manifest value against the sandbox contract.
 * Fail closed: unknown keys, unknown permissions, unsupported api versions and
 * non-namespaced contribution ids are all rejected (Goal 4 exit gate).
 */
export function validateManifest(value: unknown): PluginManifest {
  if (!isRecord(value)) throw new ManifestError('INVALID_MANIFEST', 'Manifest must be a JSON object')
  const unknown = Object.keys(value).filter(key =>
    !['id', 'name', 'version', 'apiVersion', 'permissions', 'entrypoints', 'contributions', 'dev'].includes(key))
  if (unknown.length) throw new ManifestError('INVALID_MANIFEST', `Unknown manifest key(s): ${unknown.join(', ')}`)
  const id = value.id
  if (typeof id !== 'string' || id.length > 128 || !pluginIdPattern.test(id)) {
    throw new ManifestError('INVALID_MANIFEST', `Manifest id "${String(id)}" is not a valid reverse-domain plugin id`)
  }
  if (typeof value.name !== 'string' || value.name.length === 0 || value.name.length > 128) {
    throw new ManifestError('INVALID_MANIFEST', 'Manifest name must be a non-empty string of at most 128 characters')
  }
  if (typeof value.version !== 'string' || !semverPattern.test(value.version)) {
    throw new ManifestError('INVALID_MANIFEST', `Manifest version "${String(value.version)}" is not valid semver`)
  }
  const apiVersion = value.apiVersion
  if (typeof apiVersion !== 'number' || !Number.isInteger(apiVersion) || apiVersion < 1) {
    throw new ManifestError('INVALID_MANIFEST', 'Manifest apiVersion must be a positive integer')
  }
  if (!(SUPPORTED_PLUGIN_API_VERSIONS as readonly number[]).includes(apiVersion)) {
    throw new ManifestError(
      'UNSUPPORTED_API_VERSION',
      `Plugin apiVersion ${apiVersion} is not supported (host supports ${SUPPORTED_PLUGIN_API_VERSIONS.join(', ')})`,
    )
  }
  const permissions: PluginSessionPermission[] = []
  if (value.permissions !== undefined) {
    if (!Array.isArray(value.permissions)) throw new ManifestError('INVALID_MANIFEST', 'Manifest permissions must be an array')
    for (const permission of value.permissions) {
      if (typeof permission !== 'string' || !KNOWN_PERMISSIONS.has(permission)) {
        throw new ManifestError('INVALID_MANIFEST', `Unknown permission "${String(permission)}"`)
      }
      if (!permissions.includes(permission as PluginSessionPermission)) permissions.push(permission as PluginSessionPermission)
    }
  }
  if (value.entrypoints !== undefined) {
    if (!isRecord(value.entrypoints)) throw new ManifestError('INVALID_MANIFEST', 'Manifest entrypoints must be an object')
    const unknownEntry = Object.keys(value.entrypoints).filter(key => key !== 'panel' && key !== 'worker')
    if (unknownEntry.length) throw new ManifestError('INVALID_MANIFEST', `Unknown entrypoint(s): ${unknownEntry.join(', ')}`)
    if (value.entrypoints.panel !== undefined) assertEntry(value.entrypoints.panel, 'entrypoints.panel')
    if (value.entrypoints.worker !== undefined) assertEntry(value.entrypoints.worker, 'entrypoints.worker')
  }
  const dev = value.dev
  if (dev !== undefined) {
    if (!isRecord(dev) || typeof dev.url !== 'string' || !dev.url.startsWith('https://')) {
      throw new ManifestError('INVALID_MANIFEST', 'Manifest dev.url must be an https URL')
    }
  }
  const manifest: Record<string, unknown> = {
    id, name: value.name, version: value.version, apiVersion,
    ...(permissions.length ? { permissions } : {}),
    ...(value.entrypoints !== undefined ? { entrypoints: value.entrypoints } : {}),
    ...(value.contributions !== undefined ? { contributions: validateContributions(id, value.contributions) } : {}),
    ...(dev !== undefined ? { dev } : {}),
  }
  return manifest as unknown as PluginManifest
}

/** Negotiate the API version a session will speak (Goal 4: API negotiation). */
export const negotiateApiVersion = (manifest: Pick<PluginManifest, 'apiVersion'>): number => {
  if (!(SUPPORTED_PLUGIN_API_VERSIONS as readonly number[]).includes(manifest.apiVersion)) {
    throw new ManifestError('UNSUPPORTED_API_VERSION', `No compatible API version for ${manifest.apiVersion}`)
  }
  return PLUGIN_API_VERSION
}

export type { PluginPermission }
