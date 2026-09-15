/**
 * Tower Lab panel — form + 2D elevation preview + semantic regeneration.
 * UI is plain DOM (sandboxed iframe, no framework), identical in spirit to the
 * built-in TowerGeneratorDialog but talking to the host through the SDK RPC.
 */
import { PluginPanelClient } from '@buckle/plugin-sdk'
import { generateTowerElevation } from './towerElevation.ts'
import { generateTowerGraph, validateTowerParams } from './towerGraph.ts'
import type { TowerPlanInput } from './towerGraph.ts'
import { planTowerRegeneration } from './towerPlan.ts'
import type { PlanSnapshot, TowerPlan } from './towerPlan.ts'

const api = PluginPanelClient.forParentWindow()
const GENERATOR_VERSION = 'tower-plugin@1'
const PARAMS_STORAGE_KEY = 'tower-plugin-params'

const form = document.querySelector<HTMLFormElement>('#tower-form')!
const status = document.querySelector<HTMLDivElement>('#status')!
const planBox = document.querySelector<HTMLDivElement>('#plan-summary')!
const confirmBox = document.querySelector<HTMLDivElement>('#confirm-box')!
const generateButton = document.querySelector<HTMLButtonElement>('#generate')!
const analyzeButton = document.querySelector<HTMLButtonElement>('#analyze')!
const canvas = document.querySelector<HTMLCanvasElement>('#preview')!
let snapshot: PlanSnapshot | null = null
let plan: TowerPlan | null = null
let busy = false

const field = (name: string): HTMLInputElement | HTMLSelectElement =>
  form.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!
const num = (name: string): number => Number(field(name).value)
const bool = (name: string): boolean => (field(name) as HTMLInputElement).type === 'checkbox'
  ? (field(name) as HTMLInputElement).checked
  : field(name).value === 'true'

function readForm(): TowerPlanInput {
  return {
    circuit: field('circuit').value,
    bodyHeight: num('bodyHeight'),
    peakHeight: num('peakHeight'),
    baseWidth: num('baseWidth'),
    topWidth: num('topWidth'),
    panelCount: num('panelCount'),
    straightPanels: num('straightPanels'),
    taper: field('taper').value === 'step' ? 'step' : 'linear',
    armCount: num('armCount'),
    armLength: num('armLength'),
    armDrop: num('armDrop'),
    armSpacing: num('armSpacing'),
    legSectionId: num('legSectionId'),
    braceSectionId: num('braceSectionId'),
    autoSupports: bool('autoSupports'),
    supportKind: field('supportKind').value === 'fixed' ? 'fixed' : 'pinned',
    autoLoads: bool('autoLoads'),
    windX: num('windX'),
    windY: num('windY'),
    windZ: num('windZ'),
    windForce: num('windForce'),
    gravity: num('gravity'),
  }
}

function show(message: string, kind: 'info' | 'success' | 'error' = 'info') {
  status.textContent = message
  status.className = kind
}

function snapshotCollection(name: string): Record<string, unknown>[] {
  const value = (snapshot as unknown as Record<string, unknown>)[name]
  return Array.isArray(value) ? value as Record<string, unknown>[] : []
}

function fillSectionSelects() {
  const sections = snapshotCollection('sections')
  for (const name of ['legSectionId', 'braceSectionId']) {
    const select = field(name) as HTMLSelectElement
    const previous = select.value
    select.replaceChildren()
    for (const section of sections) {
      const option = document.createElement('option')
      option.value = String(section.id)
      const material = section.material as { name?: string } | null | undefined
      option.textContent = `#${section.id} ${String(section.name ?? '')} (${String(section.type ?? '?')}${material?.name ? `, ${material.name}` : ''})`
      select.append(option)
    }
    if (sections.some(section => String(section.id) === previous)) select.value = previous
  }
}

async function refresh() {
  snapshot = await api.query() as unknown as PlanSnapshot
  fillSectionSelects()
  drawPreview()
  plan = null
  confirmBox.classList.add('hidden')
  planBox.classList.add('hidden')
  generateButton.disabled = true
  const objects = snapshotCollection('parametricObjects')
  const existing = objects.find(o => o.kind === 'TowerPlugin')
  show(existing
    ? `Model đã có object TowerPlugin #${String(existing.id)} — sẽ cập nhật bằng diff.`
    : 'Chưa có object TowerPlugin trong model — lần tạo đầu sẽ thêm mới toàn bộ.')
}
// ── 2D elevation preview (port của drawElevation trong built-in dialog) ──
const COLORS = {
  surface: '#17202b', faint: '#5a6b7d', leg: '#e0e0e0', brace: '#8ab4f8',
  belt: '#c9c9c9', peak: '#e0e0e0', arm: '#f2b24b', support: '#32d74b',
} as const

function drawPreview() {
  const params = readForm()
  const error = validateTowerParams(params)
  const geometry = error ? null : generateTowerElevation(params)
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth || 320
  const h = canvas.clientHeight || 480
  canvas.width = w * dpr
  canvas.height = h * dpr
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)
  ctx.fillStyle = COLORS.surface
  ctx.fillRect(0, 0, w, h)
  if (!geometry || geometry.height <= 0) {
    ctx.fillStyle = COLORS.faint
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(error ?? 'No preview', w / 2, h / 2)
    return
  }
  const pad = 18
  const scale = Math.min((w - pad * 2) / Math.max(geometry.width, 1e-3), (h - pad * 2) / Math.max(geometry.height, 1e-3))
  const mapX = (x: number) => w / 2 + x * scale
  const mapY = (y: number) => h - pad - y * scale
  ctx.strokeStyle = COLORS.faint
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(mapX(-geometry.width / 2 - 1), mapY(0))
  ctx.lineTo(mapX(geometry.width / 2 + 1), mapY(0))
  ctx.stroke()
  const colorFor = (kind: string) =>
    kind === 'leg' ? COLORS.leg : kind === 'brace' ? COLORS.brace
      : kind === 'belt' ? COLORS.belt : kind === 'peak' ? COLORS.peak : COLORS.arm
  ctx.lineCap = 'round'
  for (const seg of geometry.segments) {
    ctx.strokeStyle = colorFor(seg.kind)
    ctx.lineWidth = seg.kind === 'leg' ? 2.5 : 1.2
    ctx.beginPath()
    ctx.moveTo(mapX(seg.from.x), mapY(seg.from.y))
    ctx.lineTo(mapX(seg.to.x), mapY(seg.to.y))
    ctx.stroke()
  }
  ctx.fillStyle = COLORS.support
  for (const base of geometry.baseNodes) {
    ctx.beginPath()
    ctx.arc(mapX(base.x), mapY(base.y), 3, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = COLORS.arm
  for (const tip of geometry.armTips) {
    ctx.beginPath()
    ctx.arc(mapX(tip.x), mapY(tip.y), 2.5, 0, Math.PI * 2)
    ctx.fill()
  }
}

function analyze() {
  if (!snapshot || busy) return
  const params = readForm()
  const invalid = validateTowerParams(params)
  if (invalid) { show(invalid, 'error'); return }
  if (!params.legSectionId || !params.braceSectionId) { show('Hãy tạo section trong model trước khi sinh trụ.', 'error'); return }
  try {
    const graph = generateTowerGraph(params)
    plan = planTowerRegeneration(graph, snapshot, params, GENERATOR_VERSION)
  } catch (error) {
    plan = null
    show(`Không lập được kế hoạch: ${error instanceof Error ? error.message : String(error)}`, 'error')
    return
  }
  const { summary } = plan
  planBox.textContent = `Kế hoạch: tạo ${summary.created} · cập nhật ${summary.updated} · xóa ${summary.deleted}`
  planBox.classList.remove('hidden')
  confirmBox.classList.toggle('hidden', !plan.requiresApproval)
  generateButton.disabled = plan.command.payload.operations.length === 0
  show(summary.deleted > 0
    ? `Cần phê duyệt xóa ${summary.deleted} entity không còn dùng (cascade tắt).`
    : 'Nhấn Tạo trụ để thực thi (1 transaction = 1 bước Undo).')
}

async function generate(retried = false) {
  if (!snapshot || !plan || busy) return
  if (plan.requiresApproval && !confirmBox.dataset.approved) {
    confirmBox.dataset.approved = '1'
    confirmBox.classList.remove('hidden')
    show('Đã sẵn sàng xóa entity cũ — nhấn Tạo trụ lần nữa để xác nhận (approval destructive).', 'info')
    return
  }
  busy = true
  analyzeButton.disabled = true
  generateButton.disabled = true
  const current = plan
  show('Đang thực thi…')
  try {
    const outcome = await api.call('model.execute', {
      command: current.command,
      expectedModelRevision: snapshot.revision,
      ...(current.requiresApproval ? { approval: true } : {}),
    }) as { ok: true; result: unknown } | { ok: false; code: string; message: string }
    if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.message}`)
    const result = outcome.result as { changes?: Record<string, Record<string, number[]>> | null }
    const parts: string[] = []
    if (result.changes) {
      for (const [collection, delta] of Object.entries(result.changes)) {
        const total = (delta.created?.length ?? 0) + (delta.updated?.length ?? 0) + (delta.deleted?.length ?? 0)
        if (total) parts.push(`${collection}: +${delta.created?.length ?? 0}/~${delta.updated?.length ?? 0}/-${delta.deleted?.length ?? 0}`)
      }
    }
    show(`Hoàn tất. ${parts.join(' · ') || 'Không có thay đổi nào.'} Một bước Undo hoàn tác toàn bộ.`, 'success')
    void api.notify(`Tower plugin: tạo ${current.summary.created}, sửa ${current.summary.updated}, xóa ${current.summary.deleted}`, 'success').catch(() => {})
    plan = null
    confirmBox.classList.add('hidden')
    planBox.classList.add('hidden')
    generateButton.disabled = true
    await refresh()
    await api.storageSet('project', PARAMS_STORAGE_KEY, readForm()).catch(() => {})
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!retried && /REVISION_CONFLICT|revision conflict/i.test(message)) {
      show('Model vừa thay đổi (revision conflict) — nạp lại và phân tích lại…', 'info')
      await refresh()
      busy = false
      analyzeButton.disabled = false
      analyze()
      void generate(true).catch(() => {})
      return
    }
    show(`Thực thi thất bại: ${message}. Hãy phân tích lại.`, 'error')
    plan = null
    confirmBox.classList.add('hidden')
    generateButton.disabled = true
  } finally {
    busy = false
    analyzeButton.disabled = false
  }
}

// ── Init ─────────────────────────────────────────────────────────────────
async function restoreParams() {
  try {
    const saved = await api.storageGet('project', PARAMS_STORAGE_KEY)
    if (saved && typeof saved === 'object') {
      for (const [name, value] of Object.entries(saved as Record<string, unknown>)) {
        const input = form.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)
        if (!input) continue
        if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = value === true
        else input.value = String(value)
      }
    }
  } catch { /* storage denied — defaults are fine */ }
}

form.addEventListener('input', () => {
  plan = null
  generateButton.disabled = true
  confirmBox.classList.add('hidden')
  confirmBox.removeAttribute('data-approved')
  planBox.classList.add('hidden')
  drawPreview()
})
form.addEventListener('submit', event => { event.preventDefault(); analyze() })
analyzeButton.addEventListener('click', () => analyze())
generateButton.addEventListener('click', () => { void generate() })
document.querySelector<HTMLButtonElement>('#reload')!.addEventListener('click', () => {
  void refresh().catch(error => show(`Không nạp được model: ${String(error)}`, 'error'))
})

void (async () => {
  await restoreParams()
  try {
    await refresh()
  } catch (error) {
    show(`Không nạp được model: ${String(error)}`, 'error')
  }
})()
