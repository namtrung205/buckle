import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Stack, TextField,
  Tooltip, Typography,
} from '@mui/material'
import { Close, DeleteOutline, Send, Settings, SmartToy, Stop, Undo } from '@mui/icons-material'
import { observer } from 'mobx-react-lite'
import { useModel } from '../../model/Context'
import { colors } from '../../theme'
import { isToolAllowed, type AiMode, type AiToolCall, type AiToolResponse } from '../../core/ai'
import { COMMAND_SCHEMA_VERSION, type EntityReference } from '../../core/structural'
import { generateFrameArrayGraph, generateGridGraph, generatePortalFrameGraph } from '../../model/Generators/BasicParametricGenerators'
import { generateWarehouseGraph } from '../../model/Generators/WarehouseGenerator'

type Message = { id: string; role: 'user' | 'assistant' | 'error' | 'activity'; text: string; affected?: EntityReference[] }
type ProviderKind = 'openai' | 'deepseek' | 'anthropic' | 'gemini' | 'openrouter' | 'nvidia' | 'compatible'
type ProviderConnection = { id: string; provider: ProviderKind; label: string; baseUrl: string; models: string[]; keyHint: string }
type TurnResult = { message: string; toolCalls: AiToolCall[]; contextRevision: number; finishReason: 'tool_calls' | 'stop' | 'cancelled' }
type PendingApproval = { tool: string; args: Record<string, unknown>; preview: NonNullable<AiToolResponse['preview']> }

const apiRoot = (import.meta.env.VITE_BACKEND_SERVER || 'http://localhost:8000').replace(/\/$/, '')
const sessionKey = 'buckle.copilot.session'
const conversationKey = 'buckle.copilot.conversation'
const messagesKey = 'buckle.copilot.messages'
const modeKey = 'buckle.copilot.mode'
const copilotSessionId = sessionStorage.getItem(sessionKey) ?? crypto.randomUUID()
sessionStorage.setItem(sessionKey, copilotSessionId)
const apiHeaders = { 'Content-Type': 'application/json', 'X-Copilot-Session': copilotSessionId }
const newMessage = (role: Message['role'], text: string): Message => ({ id: crypto.randomUUID(), role, text })
const httpDetailMessage = (body: unknown, fallback: string): string => {
  const detail = (body as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const messages = detail.map(item => {
      const record = (item ?? {}) as { msg?: unknown; loc?: unknown }
      const field = Array.isArray(record.loc) ? record.loc.filter(part => part !== 'body').join('.') : ''
      const text = typeof record.msg === 'string' ? record.msg : JSON.stringify(record)
      return field ? `${field}: ${text}` : text
    }).filter(Boolean)
    if (messages.length) return messages.join('; ')
  }
  if (detail && typeof detail === 'object') return JSON.stringify(detail)
  return fallback
}
const initialMessages = (): Message[] => {
  try {
    const stored = JSON.parse(sessionStorage.getItem(messagesKey) ?? 'null')
    if (Array.isArray(stored)) return stored.slice(-50)
  } catch { /* ignore invalid session state */ }
  return [newMessage('assistant', 'Tôi có thể truy vấn, chọn, chỉnh sửa và tạo mô hình. Chọn mode phù hợp trước khi gửi lệnh.')]
}
const initialMode = (): AiMode => {
  const value = sessionStorage.getItem(modeKey)
  return value === 'Inspect' || value === 'Edit' || value === 'Modeling' || value === 'Generate' || value === 'Agent' ? value : 'Inspect'
}
const affectedRefs = (response: AiToolResponse): EntityReference[] => Object.entries(response.ids ?? {}).flatMap(([collection, ids]) =>
  (ids ?? []).map(id => ({ collection: collection as EntityReference['collection'], id })),
)
const activityText = (response: AiToolResponse) => {
  if (!response.ok) return `${response.tool}: ${response.error?.message ?? 'failed'}`
  const preview = response.preview
  if (preview) return `${response.tool}: +${preview.created} ~${preview.updated} −${preview.deleted}${response.undoToken ? ` · revision ${response.revision}` : ''}`
  const data = response.data as { total?: number } | undefined
  return `${response.tool}${data?.total === undefined ? '' : `: ${data.total} result(s)`}`
}

async function streamTurn(payload: Record<string, unknown>, signal: AbortSignal, onText: (text: string) => void): Promise<TurnResult> {
  const response = await fetch(`${apiRoot}/api/copilot/turn/stream`, { method: 'POST', headers: apiHeaders, body: JSON.stringify(payload), signal })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(httpDetailMessage(body, `Copilot request failed (${response.status})`))
  }
  if (!response.body) throw new Error('Provider stream is unavailable')
  const reader = response.body.getReader(); const decoder = new TextDecoder()
  let buffer = ''; let result: TurnResult | undefined
  const consume = (block: string) => {
    let event = 'message'; const data: string[] = []
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      if (line.startsWith('data:')) data.push(line.slice(5).trim())
    }
    if (!data.length) return
    const value = JSON.parse(data.join('\n'))
    if (event === 'text') onText(value.text ?? '')
    if (event === 'result') result = value as TurnResult
    if (event === 'cancelled') result = { message: '', toolCalls: [], contextRevision: 0, finishReason: 'cancelled' }
    if (event === 'error') throw new Error(typeof value.message === 'string' ? value.message : httpDetailMessage(value, 'Provider stream failed'))
  }
  while (true) {
    const { done, value } = await reader.read(); buffer += decoder.decode(value, { stream: !done })
    const blocks = buffer.split(/\r?\n\r?\n/); buffer = blocks.pop() ?? ''
    for (const block of blocks) consume(block)
    if (done) break
  }
  if (buffer.trim()) consume(buffer)
  if (!result) throw new Error('Provider stream ended without a result')
  return result
}

const CopilotPanel = observer(() => {
  const model = useModel()
  const [open, setOpen] = useState(false); const [prompt, setPrompt] = useState(''); const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<AiMode>(initialMode); const [settingsOpen, setSettingsOpen] = useState(false)
  const [connections, setConnections] = useState<ProviderConnection[]>([]); const [selectedConnectionId, setSelectedConnectionId] = useState(''); const [selectedModel, setSelectedModel] = useState('')
  const [connectionError, setConnectionError] = useState(''); const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [streamingText, setStreamingText] = useState('')
  const [pending, setPending] = useState<PendingApproval | null>(null); const [lastUndoToken, setLastUndoToken] = useState('')
  const [conversationId, setConversationId] = useState(() => sessionStorage.getItem(conversationKey) ?? crypto.randomUUID())
  const abortRef = useRef<AbortController | null>(null); const requestIdRef = useRef('')
  const [connectionDraft, setConnectionDraft] = useState({ provider: 'deepseek' as ProviderKind, label: '', apiKey: '', baseUrl: '', modelIds: '' })

  const parametricGenerators = useMemo(() => ({
    Grid: { version: 1, generatorVersion: 'grid@1', generator: generateGridGraph as never },
    PortalFrame: { version: 1, generatorVersion: 'portal-frame@1', generator: generatePortalFrameGraph as never },
    FrameArray: { version: 1, generatorVersion: 'frame-array@1', generator: generateFrameArrayGraph as never },
    Warehouse: { version: 1, generatorVersion: 'warehouse@1', generator: ((raw: Record<string, unknown>) => {
      const sectionId = Number(raw.sectionId ?? [...model.structuralDocument.sections.keys()][0]); const section = model.structuralDocument.sections.get(sectionId)
      if (!section) throw new Error('Warehouse requires a valid sectionId')
      return generateWarehouseGraph({
        width: 20, length: 60, height: 6, pitch: 15, numBays: 5, numPurlins: 3,
        sectionId, materialId: section.materialId, sectionArea: Number(section.properties?.A ?? 0.01),
        hasBracing: true, addSelfWeight: true, addWindLoad: false, windMagnitude: 1.2,
        addSnowLoad: false, snowMagnitude: 0.8, addMembrane: false, membraneThickness: 0.002,
        windOnRoof: true, windOnSideWalls: true, windOnEndWalls: true, snowOnRoof: true, ...raw,
      } as never)
    }) as never },
  }), [model])
  const executor = useMemo(() => model.createAiToolExecutor(parametricGenerators), [model, parametricGenerators])
  useEffect(() => { sessionStorage.setItem(messagesKey, JSON.stringify(messages.slice(-50))) }, [messages])
  useEffect(() => { sessionStorage.setItem(modeKey, mode) }, [mode])
  useEffect(() => { sessionStorage.setItem(conversationKey, conversationId) }, [conversationId])

  const context = () => ({ ...executor.queries.getModelSummary(), selection: executor.queries.getSelection().selection,
    sections: executor.queries.getEntities('sections').slice(0, 100), materials: executor.queries.getEntities('materials').slice(0, 100),
    capabilities: { parametricKinds: Object.keys(parametricGenerators), commonQueries: ['computed member length', 'semantic role', 'section', 'material', 'position', 'connectivity'] } })

  const loadConnections = async () => {
    try {
      const response = await fetch(`${apiRoot}/api/copilot/connections`, { headers: apiHeaders }); if (!response.ok) throw new Error(`Cannot load providers (${response.status})`)
      const values = await response.json() as ProviderConnection[]; setConnections(values)
      const selected = values.find(value => value.id === selectedConnectionId) ?? values[0]
      setSelectedConnectionId(selected?.id ?? ''); setSelectedModel(current => selected?.models.includes(current) ? current : selected?.models[0] ?? '')
    } catch (error) { setConnectionError(error instanceof Error ? error.message : String(error)) }
  }
  useEffect(() => { if (open) void loadConnections() }, [open])

  const saveConnection = async () => {
    setConnectionError('')
    try {
      const response = await fetch(`${apiRoot}/api/copilot/connections`, { method: 'POST', headers: apiHeaders, body: JSON.stringify({
        provider: connectionDraft.provider, apiKey: connectionDraft.apiKey,
        ...(connectionDraft.label.trim() ? { label: connectionDraft.label.trim() } : {}), ...(connectionDraft.baseUrl.trim() ? { baseUrl: connectionDraft.baseUrl.trim() } : {}),
        modelIds: connectionDraft.modelIds.split(',').map(value => value.trim()).filter(Boolean),
      }) }); const body = await response.json(); if (!response.ok) throw new Error(httpDetailMessage(body, `Connection failed (${response.status})`))
      const created = body as ProviderConnection; setConnections(current => [...current.filter(value => value.id !== created.id), created])
      setSelectedConnectionId(created.id); setSelectedModel(created.models[0] ?? ''); setConnectionDraft(current => ({ ...current, apiKey: '' })); setSettingsOpen(false)
    } catch (error) { setConnectionError(error instanceof Error ? error.message : String(error)) }
  }
  const removeConnection = async (id: string) => {
    await fetch(`${apiRoot}/api/copilot/connections/${encodeURIComponent(id)}`, { method: 'DELETE', headers: apiHeaders })
    const remaining = connections.filter(connection => connection.id !== id); setConnections(remaining); setSelectedConnectionId(remaining[0]?.id ?? ''); setSelectedModel(remaining[0]?.models[0] ?? '')
  }

  const runConversation = async (text: string) => {
    const controller = new AbortController(); abortRef.current = controller; const requestId = crypto.randomUUID(); requestIdRef.current = requestId
    const toolDefinitions = executor.registry.list().filter(tool => isToolAllowed(mode, tool)).map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }))
    const history = messages.filter(message => message.role === 'user' || message.role === 'assistant').slice(-12).map(message => ({ role: message.role as 'user' | 'assistant', content: message.text }))
    let toolResults: Array<{ toolCallId: string; tool: string; ok: boolean; content: Record<string, unknown> }> = []
    for (let round = 0; round < 6; round++) {
      let streamed = ''; setStreamingText(''); const startRevision = model.structuralDocument.revision
      const result = await streamTurn({ requestId, conversationId, prompt: text, mode, context: context(), history, tools: toolDefinitions, toolResults, connectionId: selectedConnectionId, model: selectedModel }, controller.signal, chunk => { streamed += chunk; setStreamingText(current => current + chunk) })
      if (result.finishReason === 'cancelled') return
      setStreamingText('')
      if (!result.toolCalls.length) { setMessages(current => [...current, newMessage('assistant', result.message || streamed || 'Done.')]); return }
      if (model.structuralDocument.revision !== startRevision || result.contextRevision !== startRevision) throw new Error('Model changed while Copilot was planning. Please submit again with refreshed context.')
      toolResults = []
      for (const providerCall of result.toolCalls) {
        const call = { ...providerCall, id: `${requestId}:${round}:${providerCall.id}` }; const response = executor.execute(call, mode); const refs = affectedRefs(response)
        setMessages(current => [...current, { id: crypto.randomUUID(), role: 'activity', text: activityText(response), ...(refs.length ? { affected: refs } : {}) }])
        if (response.undoToken) setLastUndoToken(response.undoToken)
        const explicitPreview = call.name === 'preview_transaction' || call.arguments.preview === true
        if (response.preview && (response.preview.requiresApproval || explicitPreview)) {
          const args = { ...call.arguments, preview: false, ...(response.preview.approvalToken ? { approvalToken: response.preview.approvalToken } : {}) }
          setPending({ tool: call.name === 'preview_transaction' ? 'execute_transaction' : call.name, args, preview: response.preview })
          setMessages(current => [...current, newMessage('assistant', result.message || 'Review the proposed change before applying.')]); return
        }
        toolResults.push({ toolCallId: call.id, tool: call.name, ok: response.ok, content: response as unknown as Record<string, unknown> })
      }
    }
    throw new Error('Copilot exceeded the six-round conversation budget')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault(); const text = prompt.trim(); if (!text || busy) return
    if (!selectedConnectionId || !selectedModel) { setSettingsOpen(true); setConnectionError('Connect a provider and select a model first.'); return }
    setPrompt(''); setBusy(true); setPending(null); setMessages(current => [...current, newMessage('user', text)])
    try { await runConversation(text) } catch (error) { if ((error as Error).name !== 'AbortError') setMessages(current => [...current, newMessage('error', error instanceof Error ? error.message : String(error))]) }
    finally { setBusy(false); setStreamingText(''); abortRef.current = null }
  }
  const stop = () => {
    abortRef.current?.abort(); if (requestIdRef.current) void fetch(`${apiRoot}/api/copilot/cancel/${encodeURIComponent(requestIdRef.current)}`, { method: 'POST', headers: apiHeaders })
    setBusy(false); setStreamingText(''); setMessages(current => [...current, newMessage('assistant', 'Đã dừng. Không command chưa hoàn tất nào được áp dụng.')])
  }
  const applyPending = () => {
    if (!pending) return
    const response = executor.execute({ id: crypto.randomUUID(), name: pending.tool, arguments: pending.args }, mode)
    setMessages(current => [...current, newMessage(response.ok ? 'activity' : 'error', activityText(response))]); if (response.undoToken) setLastUndoToken(response.undoToken); setPending(null)
  }
  const undoAi = () => {
    if (!lastUndoToken) return
    const response = executor.execute({ id: crypto.randomUUID(), name: 'undo_last_ai_change', arguments: { undoToken: lastUndoToken } }, mode)
    setMessages(current => [...current, newMessage(response.ok ? 'activity' : 'error', response.ok ? `Undo complete · revision ${response.revision}` : response.error!.message)]); if (response.ok) setLastUndoToken('')
  }
  const clearContext = () => { setConversationId(crypto.randomUUID()); setPending(null); setLastUndoToken(''); setMessages([newMessage('assistant', 'Context cleared. What would you like to inspect or model?')]) }
  const selectAffected = (refs: EntityReference[]) => model.executeCommand({ commandId: crypto.randomUUID(), type: 'SetSelection', schemaVersion: COMMAND_SCHEMA_VERSION, modelRevision: model.structuralDocument.revision, source: 'ui', payload: { entities: refs } })

  if (!open) return <Tooltip title="AI Copilot"><IconButton onClick={() => setOpen(true)} sx={{ position: 'fixed', right: 18, bottom: 38, zIndex: 1300, bgcolor: colors.accent, color: '#fff', '&:hover': { bgcolor: colors.accentHover } }}><SmartToy /></IconButton></Tooltip>
  return <Paper elevation={12} sx={{ position: 'fixed', right: 16, bottom: 36, zIndex: 1300, width: 430, height: 610, display: 'flex', flexDirection: 'column', bgcolor: colors.surface, border: `1px solid ${colors.border}`, overflow: 'hidden' }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: .5, px: 1, py: .75, borderBottom: `1px solid ${colors.border}` }}><SmartToy sx={{ color: colors.accentSoft }} /><Typography sx={{ fontWeight: 700, fontSize: 14 }}>Buckle AI</Typography>
      <Select size="small" value={mode} onChange={event => setMode(event.target.value as AiMode)} sx={{ width: 104, height: 30, fontSize: 11 }}>{(['Inspect', 'Edit', 'Modeling', 'Generate', 'Agent'] as AiMode[]).map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}</Select>
      <Select size="small" value={selectedConnectionId && selectedModel ? `${selectedConnectionId}|${selectedModel}` : ''} onChange={event => { const [id, ...rest] = event.target.value.split('|'); setSelectedConnectionId(id); setSelectedModel(rest.join('|')) }} displayEmpty sx={{ flex: 1, height: 30, fontSize: 11, minWidth: 0 }} renderValue={value => value ? selectedModel : 'Choose model'}>{connections.flatMap(connection => connection.models.map(modelId => <MenuItem key={`${connection.id}|${modelId}`} value={`${connection.id}|${modelId}`}>{connection.label} · {modelId}</MenuItem>))}</Select>
      <Tooltip title="Provider settings"><IconButton size="small" onClick={() => { setConnectionError(''); setSettingsOpen(true) }}><Settings fontSize="small" /></IconButton></Tooltip><Tooltip title="Undo last AI change"><span><IconButton size="small" disabled={!lastUndoToken || busy} onClick={undoAi}><Undo fontSize="small" /></IconButton></span></Tooltip><IconButton size="small" onClick={() => setOpen(false)}><Close fontSize="small" /></IconButton>
    </Box>
    <Box sx={{ flex: 1, overflowY: 'auto', p: 1.25, display: 'flex', flexDirection: 'column', gap: .8 }}>{messages.map(message => <Box key={message.id} sx={{ alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: message.role === 'activity' ? '100%' : '88%', bgcolor: message.role === 'user' ? colors.accentHover : message.role === 'activity' ? colors.bg : colors.surfaceAlt, border: message.role === 'activity' ? `1px solid ${colors.border}` : undefined, color: message.role === 'error' ? colors.danger : colors.text, px: 1.1, py: .7, borderRadius: 1, fontSize: message.role === 'activity' ? 11 : 13, whiteSpace: 'pre-wrap' }}>{message.text}{!!message.affected?.length && <Button size="small" sx={{ ml: 1, fontSize: 10 }} onClick={() => selectAffected(message.affected!)}>Select</Button>}</Box>)}
      {pending && <Box sx={{ border: `1px solid ${colors.secondary}`, borderRadius: 1, p: 1, bgcolor: colors.bg }}><Typography fontSize={12} fontWeight={700}>Proposed change</Typography><Typography fontSize={12}>Add {pending.preview.created} · Update {pending.preview.updated} · Delete {pending.preview.deleted} · Risk {pending.preview.risk}</Typography><Stack direction="row" spacing={1} mt={1}><Button size="small" variant="contained" onClick={applyPending}>Apply</Button><Button size="small" onClick={() => setPending(null)}>Reject</Button></Stack></Box>}
      {streamingText && <Box sx={{ alignSelf: 'flex-start', maxWidth: '88%', bgcolor: colors.surfaceAlt, px: 1.1, py: .7, borderRadius: 1, fontSize: 13, whiteSpace: 'pre-wrap' }}>{streamingText}</Box>}
      {busy && <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={16} /><Typography fontSize={11}>Planning and running tools…</Typography></Stack>}
    </Box>
    <Box component="form" onSubmit={submit} sx={{ p: 1, borderTop: `1px solid ${colors.border}` }}><Stack direction="row" spacing={1}><TextField value={prompt} onChange={event => setPrompt(event.target.value)} disabled={busy} size="small" fullWidth multiline maxRows={3} placeholder={mode === 'Inspect' ? 'Tìm các member thép dài dưới 5 m…' : 'Nhập yêu cầu mô hình…'} inputProps={{ 'aria-label': 'Copilot prompt' }} />{busy ? <IconButton onClick={stop} color="error"><Stop /></IconButton> : <IconButton type="submit" disabled={!prompt.trim()} color="primary"><Send /></IconButton>}</Stack><Stack direction="row" justifyContent="space-between" alignItems="center" mt={.5}><Typography fontSize={10} color={colors.textFaint}>{mode} · Z-up · m · kN</Typography><Button size="small" onClick={clearContext}>Clear context</Button></Stack></Box>
    <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="xs" fullWidth><DialogTitle>AI provider connections</DialogTitle><DialogContent><Stack spacing={1.5} sx={{ pt: 1 }}>{connections.map(connection => <Box key={connection.id} sx={{ display: 'flex', alignItems: 'center', p: 1, bgcolor: colors.surfaceAlt, borderRadius: 1 }}><Box sx={{ flex: 1, minWidth: 0 }}><Typography fontSize={13} fontWeight={700}>{connection.label}</Typography><Typography fontSize={11} color={colors.textDim}>{connection.models.length} models · {connection.keyHint}</Typography></Box><IconButton size="small" onClick={() => void removeConnection(connection.id)}><DeleteOutline fontSize="small" /></IconButton></Box>)}<FormControl size="small" fullWidth><InputLabel>Provider</InputLabel><Select label="Provider" value={connectionDraft.provider} onChange={event => setConnectionDraft(current => ({ ...current, provider: event.target.value as ProviderKind }))}>{(['openai', 'deepseek', 'anthropic', 'gemini', 'openrouter', 'nvidia', 'compatible'] as ProviderKind[]).map(value => <MenuItem key={value} value={value}>{value === 'gemini' ? 'Google Gemini' : value === 'nvidia' ? 'NVIDIA NIM (build.nvidia.com)' : value}</MenuItem>)}</Select></FormControl><TextField size="small" label="Connection name (optional)" value={connectionDraft.label} onChange={event => setConnectionDraft(current => ({ ...current, label: event.target.value }))} /><TextField size="small" label="API key" type="password" autoComplete="new-password" value={connectionDraft.apiKey} onChange={event => setConnectionDraft(current => ({ ...current, apiKey: event.target.value }))} />{connectionDraft.provider === 'compatible' && <TextField size="small" label="HTTPS base URL" value={connectionDraft.baseUrl} onChange={event => setConnectionDraft(current => ({ ...current, baseUrl: event.target.value }))} />}<TextField size="small" label="Model IDs (optional, comma-separated)" value={connectionDraft.modelIds} onChange={event => setConnectionDraft(current => ({ ...current, modelIds: event.target.value }))} />{connectionError && <Typography color="error" fontSize={12}>{connectionError}</Typography>}<Typography color={colors.textFaint} fontSize={11}>Keys stay only in backend memory and are isolated by browser session.</Typography></Stack></DialogContent><DialogActions><Button onClick={() => setSettingsOpen(false)}>Cancel</Button><Button variant="contained" disabled={!connectionDraft.apiKey.trim()} onClick={() => void saveConnection()}>Connect</Button></DialogActions></Dialog>
  </Paper>
})

export default CopilotPanel
