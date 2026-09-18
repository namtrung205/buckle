import { PluginPanelClient } from '@buckle/plugin-sdk'
import type { PluginModelSnapshot } from '@buckle/plugin-sdk'
import { planRename, renameCommand } from './rename.ts'
import type { RenameKind, RenameOptions, RenameRow, RenameScope } from './rename.ts'

const api = PluginPanelClient.forParentWindow()
const status = document.querySelector<HTMLDivElement>('#status')!
const list = document.querySelector<HTMLDivElement>('#preview-list')!
const applyButton = document.querySelector<HTMLButtonElement>('#apply')!
const previewButton = document.querySelector<HTMLButtonElement>('#preview')!
let planned: { rows: RenameRow[]; revision: number; optionsKey: string } | null = null
let busy = false

function options(): RenameOptions {
  return {
    kind: document.querySelector<HTMLInputElement>('input[name="kind"]:checked')!.value as RenameKind,
    scope: document.querySelector<HTMLInputElement>('input[name="scope"]:checked')!.value as RenameScope,
    prefix: document.querySelector<HTMLInputElement>('#prefix')!.value,
    suffix: document.querySelector<HTMLInputElement>('#suffix')!.value,
  }
}

const keyOf = (value: RenameOptions) => JSON.stringify(value)

function show(message: string, kind: 'info' | 'success' | 'error' = 'info') {
  status.textContent = message
  status.className = kind
}

function invalidate() {
  planned = null
  applyButton.disabled = true
  list.replaceChildren()
  show('Nhấn “Xem trước” để đọc model và selection hiện tại.')
}

function render(rows: readonly RenameRow[]) {
  list.replaceChildren()
  for (const row of rows.slice(0, 100)) {
    const item = document.createElement('div')
    item.className = 'row'
    const id = document.createElement('span')
    id.className = 'id'
    id.textContent = `${row.collection} #${row.id}`
    const before = document.createElement('span')
    before.textContent = row.before
    const after = document.createElement('span')
    after.className = 'after'
    after.textContent = `→ ${row.after}`
    item.append(id, before, after)
    list.append(item)
  }
  if (rows.length > 100) {
    const more = document.createElement('p')
    more.className = 'hint'
    more.textContent = `Còn ${rows.length - 100} tên khác chưa hiển thị.`
    list.append(more)
  }
}

async function preview() {
  if (busy) return
  const current = options()
  if (!current.prefix && !current.suffix) {
    invalidate()
    show('Hãy nhập ít nhất một prefix hoặc suffix.', 'error')
    return
  }
  busy = true
  previewButton.disabled = true
  applyButton.disabled = true
  show('Đang đọc model và selection…')
  try {
    const snapshot: PluginModelSnapshot = await api.query()
    const selection = current.scope === 'selected' ? await api.getSelection() : []
    const rows = planRename(snapshot, selection, current)
    planned = { rows, revision: snapshot.revision, optionsKey: keyOf(current) }
    render(rows)
    show(rows.length
      ? `Sẵn sàng đổi tên ${rows.length} ${current.kind === 'nodes' ? 'node' : 'element'}.`
      : 'Không có đối tượng phù hợp. Hãy kiểm tra selection và phạm vi.')
    applyButton.disabled = rows.length === 0
  } catch (error) {
    planned = null
    show(`Không xem trước được: ${String(error)}`, 'error')
  } finally {
    busy = false
    previewButton.disabled = false
  }
}

async function apply() {
  if (busy || !planned?.rows.length) return
  if (planned.optionsKey !== keyOf(options())) {
    invalidate()
    show('Tùy chọn đã đổi. Hãy xem trước lại.', 'error')
    return
  }
  busy = true
  applyButton.disabled = true
  previewButton.disabled = true
  const count = planned.rows.length
  show(`Đang đổi tên ${count} đối tượng…`)
  try {
    const outcome = await api.execute(renameCommand(planned.rows), planned.revision) as
      | { ok: true; result: unknown }
      | { ok: false; code: string; message: string }
    if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.message}`)
    planned = null
    list.replaceChildren()
    show(`Đã đổi tên ${count} đối tượng. Có thể Undo bằng Buckle.`, 'success')
    void api.notify(`Bulk Rename: đã đổi tên ${count} đối tượng`, 'success').catch(() => {})
  } catch (error) {
    planned = null
    show(`Đổi tên thất bại: ${String(error)}. Hãy xem trước lại.`, 'error')
  } finally {
    busy = false
    previewButton.disabled = false
  }
}

for (const input of document.querySelectorAll<HTMLInputElement>('input')) {
  input.addEventListener('input', invalidate)
  input.addEventListener('change', invalidate)
}
previewButton.addEventListener('click', () => { void preview() })
applyButton.addEventListener('click', () => { void apply() })
