/** Pin the exact reviewed ZIP bytes. This detects accidental or local-store
 * tampering; it does not authenticate the plugin's publisher. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function requireReviewedZip(
  bytes: Uint8Array,
  reviewedSha256: string | undefined,
): Promise<void> {
  if (!reviewedSha256 || !/^[a-f0-9]{64}$/.test(reviewedSha256)) {
    throw new Error('Installed ZIP has no valid review fingerprint; reinstall it before enabling')
  }
  if (await sha256Hex(bytes) !== reviewedSha256) {
    throw new Error('Installed ZIP changed since permission review; reinstall it before enabling')
  }
}
