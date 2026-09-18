/** Applied before a self-contained plugin panel is turned into a blob URL.
 * The iframe has sandbox="allow-scripts" without allow-same-origin; this CSP
 * additionally blocks direct network connections and resource exfiltration. */
export const PLUGIN_PANEL_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${PLUGIN_PANEL_CSP}">`

/** Prefix the policy before *any* plugin token. HTML allows script tags before
 * an explicit head element, so searching for <head> would be bypassable. */
export function hardenPluginPanelHtml(html: string): string {
  const withoutDoctype = html.replace(/^\s*<!doctype\s+html[^>]*>/i, '')
  return `<!doctype html>${cspMeta}${withoutDoctype}`
}
