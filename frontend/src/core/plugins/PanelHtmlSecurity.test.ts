import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hardenPluginPanelHtml, PLUGIN_PANEL_CSP } from './PanelHtmlSecurity.ts'

test('plugin panel CSP precedes inline code for documents and fragments', () => {
  for (const html of [
    '<!doctype html><html><head><script>postMessage(1)</script></head></html>',
    '<!doctype html><html><body><script>postMessage(1)</script></body></html>',
    '<!doctype html><script>postMessage(1)</script>',
    '<script>postMessage(1)</script>',
    '<script>postMessage(1)</script><head><title>late head</title></head>',
  ]) {
    const hardened = hardenPluginPanelHtml(html)
    assert.ok(hardened.indexOf('Content-Security-Policy') < hardened.indexOf('<script>'))
    assert.match(hardened, /connect-src 'none'/)
    assert.match(hardened, /script-src 'unsafe-inline'/)
  }
  assert.match(PLUGIN_PANEL_CSP, /default-src 'none'/)
})
