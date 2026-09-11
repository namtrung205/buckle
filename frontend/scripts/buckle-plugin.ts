/**
 * buckle-plugin — developer CLI for Buckle plugin authors (Goal 5).
 *
 *   node --experimental-strip-types scripts/buckle-plugin.ts validate <dir>
 *   node --experimental-strip-types scripts/buckle-plugin.ts dev <dir> [--port 5180]
 *   node --experimental-strip-types scripts/buckle-plugin.ts build <dir> [--out dist]
 *
 * `validate` checks a plugin manifest against the host schema (fail closed).
 * `dev` serves a plugin directory over HTTP and prints the dev URL to load in
 * the host's development loader. `build` validates then copies the package to
 * dist. Commands exit non-zero on any failure (CI friendly).
 */
import { createServer } from 'node:http'
import { cp, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateManifest, negotiateApiVersion, ManifestError } from '../src/core/plugins/manifest.ts'

const MANIFEST_NAMES = ['buckle.plugin.json', 'plugin.json', 'manifest.json']

export class CliError extends Error {}

/** Read + validate a plugin manifest from a directory. Returns the manifest. */
export async function readManifest(dir: string) {
  for (const name of MANIFEST_NAMES) {
    try {
      const raw = await readFile(join(dir, name), 'utf8')
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (error) {
        throw new CliError(`${name} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
      }
      return validateManifest(parsed)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
  }
  throw new CliError(`No plugin manifest (${MANIFEST_NAMES.join(' | ')}) found in ${dir}`)
}

export async function runValidate(dir: string) {
  const manifest = await readManifest(dir)
  const api = negotiateApiVersion(manifest)
  const contributions = manifest.contributions ?? {}
  const keys = ['commands', 'ribbonTabs', 'ribbon', 'panels'] as const
  const summary = keys
    .map(key => [key, (contributions[key] as readonly unknown[] | undefined)?.length ?? 0] as const)
    .filter(([, count]) => count > 0)
  console.log(`OK ${manifest.id}@${manifest.version} (api v${api})`)
  console.log(`  permissions: ${manifest.permissions.join(', ') || '(none)'}`)
  console.log(`  contributions: ${summary.map(([key, count]) => `${key}=${count}`).join(', ') || '(none)'}`)
  return manifest
}

/** Static file server for `buckle-plugin dev`. Resolves when the server closes. */
export function startDevServer(dir: string, port: number): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://localhost:${port}`)
      const relative = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)
      const body = await readFile(join(dir, relative))
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
        '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
      }
      response.writeHead(200, { 'content-type': types[extname(relative)] ?? 'application/octet-stream' })
      response.end(body)
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found')
    }
  })
  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(port, '127.0.0.1', () => resolvePromise({
      url: `http://127.0.0.1:${port}/`,
      close: () => new Promise(done => server.close(() => done())),
    }))
  })
}

export async function runDev(dir: string, port: number) {
  await runValidate(dir)
  const server = await startDevServer(resolve(dir), port)
  console.log(`dev URL: ${server.url}  (register this URL in the host's development loader)`)
  return server
}

export async function runBuild(dir: string, outDir: string) {
  await runValidate(dir)
  await mkdir(resolve(outDir), { recursive: true })
  await cp(resolve(dir), resolve(outDir), { recursive: true })
  const count = (await collectFiles(resolve(outDir))).length
  console.log(`built ${count} file(s) into ${outDir}`)
  return count
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await collectFiles(full))
    else files.push(full)
  }
  return files
}

function parsePort(argv: string[]): number {
  const index = argv.indexOf('--port')
  const raw = index >= 0 ? Number(argv[index + 1]) : NaN
  return Number.isInteger(raw) && raw > 0 && raw < 65_536 ? raw : 5180
}

async function main() {
  const [command, dir, ...rest] = process.argv.slice(2)
  try {
    if (command === 'validate' && dir) {
      await runValidate(dir)
    } else if (command === 'dev' && dir) {
      const server = await runDev(dir, parsePort(rest))
      const shutdown = async () => { await server.close(); process.exit(0) }
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
    } else if (command === 'build' && dir) {
      const outIndex = rest.indexOf('--out')
      await runBuild(dir, outIndex >= 0 ? rest[outIndex + 1] : 'dist')
    } else {
      console.error('Usage: buckle-plugin <validate|dev|build> <pluginDir> [options]')
      process.exitCode = 2
    }
  } catch (error) {
    const message = error instanceof ManifestError || error instanceof CliError
      ? error.message
      : error instanceof Error ? error.message : String(error)
    console.error(`error: ${message}`)
    process.exitCode = 1
  }
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) void main()
