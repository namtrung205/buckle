import type { BundledPlugin } from './bundle.ts'

export const BUNDLE_SIGNATURE_FILE = 'buckle.signature.json'
export const BUNDLE_SIGNATURE_FORMAT = 'buckle-ed25519-v1'

export type BundleSignature = Readonly<{
  format: typeof BUNDLE_SIGNATURE_FORMAT
  publicKey: string
  signature: string
}>

export type VerifiedBundleSignature =
  | Readonly<{ status: 'unsigned' }>
  | Readonly<{ status: 'signed'; keySha256: string }>

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export function decodeBase64(value: string, expectedLength: number): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Invalid base64 in bundle signature')
  }
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0))
  if (bytes.length !== expectedLength) throw new Error('Invalid bundle signature key or signature length')
  return bytes
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export async function canonicalBundleMessage(files: ReadonlyMap<string, Uint8Array>): Promise<Uint8Array> {
  const entries: [string, string][] = []
  for (const [path, bytes] of [...files].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    if (path === BUNDLE_SIGNATURE_FILE) continue
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))
    entries.push([path, [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')])
  }
  return encoder.encode(`Buckle plugin bundle signature v1\n${JSON.stringify(entries)}\n`)
}

export async function verifyBundleSignature(bundle: BundledPlugin): Promise<VerifiedBundleSignature> {
  const bytes = bundle.files.get(BUNDLE_SIGNATURE_FILE)
  if (!bytes) return { status: 'unsigned' }
  let value: unknown
  try { value = JSON.parse(decoder.decode(bytes)) } catch { throw new Error('Invalid bundle signature JSON') }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid bundle signature')
  const signature = value as Record<string, unknown>
  if (Object.keys(signature).sort().join(',') !== 'format,publicKey,signature' ||
      signature.format !== BUNDLE_SIGNATURE_FORMAT ||
      typeof signature.publicKey !== 'string' || typeof signature.signature !== 'string') {
    throw new Error('Unsupported or malformed bundle signature')
  }
  const publicKey = decodeBase64(signature.publicKey, 32)
  const signedBytes = decodeBase64(signature.signature, 64)
  const key = await crypto.subtle.importKey('raw', new Uint8Array(publicKey), 'Ed25519', false, ['verify'])
  const valid = await crypto.subtle.verify('Ed25519', key, new Uint8Array(signedBytes),
    new Uint8Array(await canonicalBundleMessage(bundle.files)))
  if (!valid) throw new Error('Bundle signature does not match its contents')
  const fingerprint = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(publicKey)))
  return { status: 'signed', keySha256: [...fingerprint].map(byte => byte.toString(16).padStart(2, '0')).join('') }
}
