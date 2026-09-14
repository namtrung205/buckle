import { unzipSync, strFromU8 } from 'fflate'
import { validateManifest } from './manifest.ts'
import type { PluginManifest, PluginSessionPermission } from './contract.ts'
import { BUNDLE_SIGNATURE_FILE } from './signature.ts'

export const PLUGIN_BUNDLE_MAX_BYTES = 8 * 1024 * 1024
export const PLUGIN_BUNDLE_MAX_FILES = 200
export const PLUGIN_ENTRY_MAX_BYTES = 1 * 1024 * 1024
export const PLUGIN_BUNDLE_MAX_EXPANDED_BYTES = 16 * 1024 * 1024
export const PLUGIN_BUNDLE_MAX_COMPRESSION_RATIO = 200

const MANIFEST_NAMES = ['buckle.plugin.json', 'plugin.json', 'manifest.json']
const ALLOWED_EXTENSIONS = new Set(['.json', '.js', '.mjs', '.html', '.css', '.svg', '.png', '.ico', '.txt'])
const absoluteEntryPattern = /^[a-z][a-z0-9+.-]*:/i

export class PluginLoadError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'PluginLoadError'
    this.code = code
  }
}

export type BundledPlugin = Readonly<{
  manifest: PluginManifest
  /** Normalized relative paths (no `..`, no leading slash) → raw file bytes. */
  files: ReadonlyMap<string, Uint8Array>
  source: string
}>

const slugify = (value: string): string => {
  const base = value.replace(/\.[^.]+$/, '').toLowerCase()
  const slug = base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'plugin'
  return slug.length > 40 ? slug.slice(0, 40) : slug
}

/** Wrap a single compiled worker file into a minimal worker-only manifest.
 *  Grants default to none (fail closed) — pass the permission list the worker
 *  may use. */
export const parseWorkerFile = (
  filename: string,
  data: Uint8Array,
  grants: readonly PluginSessionPermission[] = [],
): BundledPlugin => {
  const id = `com.plugins.${slugify(filename)}`
  const name = (filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') || 'Plugin').trim()
  if (data.byteLength > PLUGIN_ENTRY_MAX_BYTES) {
    throw new PluginLoadError('ENTRY_TOO_LARGE', `worker file exceeds ${PLUGIN_ENTRY_MAX_BYTES} bytes`)
  }
  const manifest = validateManifest({
    id,
    name,
    version: '0.0.1',
    apiVersion: 1,
    permissions: grants,
    entrypoints: { worker: 'index.js' },
  })
  return { manifest, files: new Map([['index.js', data]]), source: filename }
}

export const normalizeEntry = (entry: string): string => entry.replace(/^\.\/+/, '')
const normalizeArchivePath = (path: string): string => path.replace(/\\/g, '/').replace(/^(\.\/)+/, '')

const requireEntry = (files: ReadonlyMap<string, Uint8Array>, entry: string | undefined, label: string): void => {
  if (!entry) return
  if (absoluteEntryPattern.test(entry)) {
    throw new PluginLoadError('REMOTE_ENTRY_UNSUPPORTED', `${label} "${entry}" is remote — the local loader only accepts bundled files`)
  }
  if (!files.has(normalizeEntry(entry))) {
    throw new PluginLoadError('ENTRY_MISSING', `${label} "${entry}" is missing from the bundle`)
  }
}

/** Unzip + validate a plugin package. Every lookup outside the strict rule set
 *  (size, count, extension, path traversal) fails closed. */
export const parseZipBundle = (data: Uint8Array, sourceLabel = 'bundle.zip'): BundledPlugin => {
  if (data.byteLength > PLUGIN_BUNDLE_MAX_BYTES) {
    throw new PluginLoadError('BUNDLE_TOO_LARGE', `bundle exceeds ${PLUGIN_BUNDLE_MAX_BYTES} bytes`)
  }
  let rawEntries: Record<string, Uint8Array>
  let fileCount = 0
  let expandedBytes = 0
  const seenPaths = new Set<string>()
  try {
    rawEntries = unzipSync(new Uint8Array(data), { filter: info => {
      fileCount += 1
      if (fileCount > PLUGIN_BUNDLE_MAX_FILES) throw new PluginLoadError('TOO_MANY_FILES', 'too many bundle entries')
      if (info.name.endsWith('/')) return false
      const path = normalizeArchivePath(info.name)
      const segments = path.split('/')
      if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || segments.includes('..') || segments.includes('.') ||
        segments.includes('') || path.includes('\0')) {
        throw new PluginLoadError('ZIP_SLIP', `unsafe archive path "${info.name}" is rejected`)
      }
      if (seenPaths.has(path)) throw new PluginLoadError('DUPLICATE_FILE', `duplicate archive path "${path}"`)
      seenPaths.add(path)
      expandedBytes += info.originalSize
      if (info.originalSize > PLUGIN_ENTRY_MAX_BYTES) throw new PluginLoadError('ENTRY_TOO_LARGE', `${info.name} is too large`)
      if (expandedBytes > PLUGIN_BUNDLE_MAX_EXPANDED_BYTES) throw new PluginLoadError('BUNDLE_TOO_LARGE', 'expanded bundle is too large')
      if (info.originalSize > 64 * 1024 &&
        info.originalSize > info.size * PLUGIN_BUNDLE_MAX_COMPRESSION_RATIO) {
        throw new PluginLoadError('SUSPICIOUS_COMPRESSION', `${info.name} exceeds the compression ratio limit`)
      }
      return true
    } }) as Record<string, Uint8Array>
  } catch (error) {
    if (error instanceof PluginLoadError) throw error
    throw new PluginLoadError('INVALID_ARCHIVE', `${sourceLabel} is not a readable zip archive (${error instanceof Error ? error.message : String(error)})`)
  }

  const files = new Map<string, Uint8Array>()
  for (const [rawPath, bytes] of Object.entries(rawEntries)) {
    const path = normalizeArchivePath(rawPath)
    const segments = path.split('/').filter(Boolean)
    if (path.startsWith('/') || /^[a-z]:/i.test(path) || segments.includes('..')) {
      throw new PluginLoadError('ZIP_SLIP', `unsafe archive path "${rawPath}" is rejected`)
    }
    if (path.endsWith('/')) continue
    if (files.size >= PLUGIN_BUNDLE_MAX_FILES) {
      throw new PluginLoadError('TOO_MANY_FILES', `more than ${PLUGIN_BUNDLE_MAX_FILES} files in a bundle`)
    }
    const ext = path.includes('.') ? `.${path.split('.').pop()!.toLowerCase()}` : ''
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new PluginLoadError('FORBIDDEN_FILE', `file type "${ext || '(none)'}" is not allowed (${path})`)
    }
    if (bytes.byteLength > PLUGIN_ENTRY_MAX_BYTES) {
      throw new PluginLoadError('ENTRY_TOO_LARGE', `${path} exceeds ${PLUGIN_ENTRY_MAX_BYTES} bytes`)
    }
    files.set(path, bytes)
  }
  if (files.size === 0) throw new PluginLoadError('EMPTY_ARCHIVE', 'the archive contains no files')

  const manifestName = (path: string) => path.split('/').pop() ?? ''
  const manifestPath = [...files.keys()].find(path => MANIFEST_NAMES.includes(manifestName(path)))
  if (!manifestPath) {
    throw new PluginLoadError('MANIFEST_NOT_FOUND', `no plugin manifest (${MANIFEST_NAMES.join(' | ')}) in the archive`)
  }

  let manifest: PluginManifest
  try {
    manifest = validateManifest(JSON.parse(strFromU8(files.get(manifestPath)!)))
  } catch (error) {
    if (error instanceof PluginLoadError) throw error
    throw new PluginLoadError('INVALID_MANIFEST', `manifest is invalid: ${error instanceof Error ? error.message : String(error)}`)
  }

  // A build output may place the package under one folder (`dist/`): rebase to
  // that folder so every path in the manifest resolves against the stored files.
  const base = manifestPath.includes('/') ? manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1) : ''
  if (base) {
    if (files.has(`${base}${BUNDLE_SIGNATURE_FILE}`)) {
      for (const path of files.keys()) {
        if (!path.startsWith(base)) {
          throw new PluginLoadError('SIGNED_EXTRA_FILE', `signed bundle contains a file outside ${base}: ${path}`)
        }
      }
    }
    const rebased = new Map<string, Uint8Array>()
    for (const [path, bytes] of files) {
      const key = path.startsWith(base) ? path.slice(base.length) : null
      if (key) rebased.set(key, bytes)
    }
    files.clear()
    for (const [key, bytes] of rebased) files.set(key, bytes)
    if (!files.has(manifestPath.slice(base.length))) {
      throw new PluginLoadError('INVALID_MANIFEST', `manifest ${manifestPath} has no supporting files`)
    }
  }

  requireEntry(files, manifest.entrypoints?.worker, 'worker entrypoint')
  if ((manifest.contributions?.commands?.length ?? 0) > 0 && !manifest.entrypoints?.worker) {
    throw new PluginLoadError('COMMAND_WORKER_REQUIRED', 'commands require a Worker entrypoint')
  }
  requireEntry(files, manifest.entrypoints?.panel, 'panel entrypoint')
  for (const panel of manifest.contributions?.panels ?? []) requireEntry(files, panel.entry, `panel ${panel.id}`)

  return { manifest, files: new Map(files), source: sourceLabel }
}

/** Heuristic: a panel HTML that does not reference sibling package files
 *  (scripts/styles/assets) can be rendered directly from a single blob URL. */
export const isSelfContainedHtml = (html: string): boolean => {
  if (/<script[^>]*\bsrc=/i.test(html)) return false
  if (/<link[^>]*\bhref=/i.test(html)) return false
  if (/<img[^>]*\bsrc=|srcset=/i.test(html)) return false
  if (/@import\b/i.test(html)) return false
  if (/url\(\s*['"]?\s*\.{0,2}\//i.test(html)) return false
  return true
}

