import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Stack, TextField,
  Tooltip, Typography,
} from '@mui/material'
import { Close, DeleteOutline, InfoOutlined, Refresh, Send, Settings, SmartToy, Stop, Tune, Undo } from '@mui/icons-material'
import { observer } from 'mobx-react-lite'
import Draggable from 'react-draggable'
import { useModel } from '../../model/Context'
import { colors } from '../../theme'
import { isToolAllowed, type AiMode, type AiToolCall, type AiToolResponse } from '../../core/ai'
import { COMMAND_SCHEMA_VERSION, type EntityReference } from '../../core/structural'
import { createParametricGeneratorCatalogue } from '../../model/Generators/ParametricCatalogue'
import { canRetryCopilotTurn, type CopilotTurnStatus } from './CopilotRetry'
import { copilotContextConflictMessage, copilotPreviewConflictMessage } from './CopilotLoopGuard'
import { safeProviderToolArguments, approvedToolArguments } from './CopilotToolPolicy'
import { runAgent, newAgentCheckpoint, agentContextResults, AGENT_RESULT_TOOL, readAgentResult, type AgentCheckpoint } from './AgentRunner'
import MarkdownMessage from './MarkdownMessage'
import { saveCopilotArchive, loadCopilotArchive, type SavedAgentRun } from './CopilotArchive'

type Message = {
  id: string
  role: 'user' | 'assistant' | 'error' | 'activity'
  text: string
  affected?: EntityReference[]
  logicalTurnId?: string
  status?: CopilotTurnStatus
  retryCount?: number
  mutationCommitted?: boolean
}
type ProviderKind = 'openai' | 'deepseek' | 'anthropic' | 'gemini' | 'openrouter' | 'nvidia' | 'groq' | 'compatible' | 'ollama' | 'lmstudio' | 'local'
type RateLimitSettings = {
  mode: 'auto' | 'manual' | 'disabled'
  maxConcurrent: number
  rpm: number | null
  tpm: number | null
  safetyFactor: number
  maxWaitSeconds: number
  maxRetries: number
}
type ProviderConnection = { id: string; provider: ProviderKind; label: string; baseUrl: string; models: string[]; keyHint: string; rateLimit: RateLimitSettings }
type TurnResult = { message: string; toolCalls: AiToolCall[]; contextRevision: number; finishReason: 'tool_calls' | 'stop' | 'cancelled' }
type PendingApproval = { tool: string; args: Record<string, unknown>; preview: NonNullable<AiToolResponse['preview']>; revision: number; mode: AiMode }

const apiRoot = (import.meta.env.VITE_BACKEND_SERVER || 'http://localhost:8000').replace(/\/$/, '')
const sessionKey = 'buckle.copilot.session'
const conversationKey = 'buckle.copilot.conversation'
const messagesKey = 'buckle.copilot.messages'
const modeKey = 'buckle.copilot.mode'
const copilotSessionId = sessionStorage.getItem(sessionKey) ?? crypto.randomUUID()
sessionStorage.setItem(sessionKey, copilotSessionId)
const apiHeaders = { 'Content-Type': 'application/json', 'X-Copilot-Session': copilotSessionId }
const defaultRateLimit = (): RateLimitSettings => ({
  mode: 'auto', maxConcurrent: 2, rpm: null,
  tpm: null, safetyFactor: .8, maxWaitSeconds: 30, maxRetries: 2,
})
const localProviders: readonly ProviderKind[] = ['ollama', 'lmstudio', 'local']
const isLocalProvider = (provider: ProviderKind) => localProviders.includes(provider)
const localPresetBaseUrl: Record<string, string> = { ollama: 'http://localhost:11434/v1', lmstudio: 'http://localhost:1234/v1', local: '' }
const providerLabel = (provider: ProviderKind) => provider === 'gemini' ? 'Google Gemini'
  : provider === 'nvidia' ? 'NVIDIA NIM (build.nvidia.com)'
    : provider === 'groq' ? 'GroqCloud (console.groq.com)'
      : provider === 'ollama' ? 'Ollama (local)'
        : provider === 'lmstudio' ? 'LM Studio (local)'
          : provider === 'local' ? 'Custom local (OpenAI-compatible)' : provider
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
    if (Array.isArray(stored)) return stored
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

const SettingHelp = ({ text }: { text: string }) => <Tooltip arrow placement="top" title={text} componentsProps={{ tooltip: { sx: { maxWidth: 320, px: 1.5, py: 1.1, fontSize: 13, lineHeight: 1.45 } }, arrow: { sx: { color: colors.bg } } }}><InfoOutlined sx={{ ml: .75, fontSize: 17, color: colors.textFaint, cursor: 'help', verticalAlign: 'text-bottom' }} /></Tooltip>

const fieldHelperSx = { mx: 0, mt: .6, color: colors.textFaint, fontSize: 11, lineHeight: 1.35 }

const RateLimitFields = ({ value, onChange }: { value: RateLimitSettings; onChange: (next: RateLimitSettings) => void }) => {
  const number = (raw: string, fallback: number) => raw === '' ? fallback : Number(raw)
  const optionalNumber = (raw: string) => raw === '' ? null : Number(raw)
  return <Stack spacing={2} sx={{ p: { xs: 1.5, sm: 2 }, border: `1px solid ${colors.border}`, borderRadius: 1.5, bgcolor: colors.bg }}>
    <Box><Typography fontSize={14} fontWeight={700} color={colors.text}>Outbound rate limiting<SettingHelp text="Controls requests sent from Buckle to this provider connection. These limits are independent for every saved connection." /></Typography><Typography mt={.4} fontSize={12} color={colors.textDim}>Smooth bursts, wait for provider quota and retry temporary 429 responses.</Typography></Box>
    <FormControl fullWidth><InputLabel>Control mode</InputLabel><Select label="Control mode" value={value.mode} onChange={event => onChange({ ...value, mode: event.target.value as RateLimitSettings['mode'] })}><MenuItem value="auto">Auto — follow provider quota headers</MenuItem><MenuItem value="manual">Manual — enforce custom RPM and TPM</MenuItem><MenuItem value="disabled">Disabled — send immediately</MenuItem></Select></FormControl>
    {value.mode !== 'disabled' && <>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.75 }}>
        <TextField fullWidth type="number" label="Concurrent requests" value={value.maxConcurrent} helperText="Maximum requests running at the same time." FormHelperTextProps={{ sx: fieldHelperSx }} inputProps={{ min: 1, max: 10 }} onChange={event => onChange({ ...value, maxConcurrent: number(event.target.value, 1) })} />
        <TextField fullWidth type="number" label="Maximum provider wait (seconds)" value={value.maxWaitSeconds} helperText="Wait for short resets and bound 429 retry time." FormHelperTextProps={{ sx: fieldHelperSx }} inputProps={{ min: 0, max: 300 }} onChange={event => onChange({ ...value, maxWaitSeconds: number(event.target.value, 0) })} />
        <TextField fullWidth type="number" label="Retries after HTTP 429" value={value.maxRetries} helperText="Retries respect the provider Retry-After header." FormHelperTextProps={{ sx: fieldHelperSx }} inputProps={{ min: 0, max: 5 }} onChange={event => onChange({ ...value, maxRetries: number(event.target.value, 0) })} />
      </Box>
      {value.mode === 'auto' ? <Typography sx={{ px: 1.25, py: 1, borderRadius: 1, bgcolor: 'rgba(74,144,226,.10)', color: colors.accentSoft, fontSize: 12 }}>Auto mode does not apply local RPM/TPM estimates. It waits only for short quota resets reported by the provider; longer resets are confirmed by sending the request and handling a real HTTP 429.</Typography> : <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1.75 }}>
        <TextField fullWidth type="number" label="Requests per minute (RPM)" value={value.rpm ?? ''} placeholder="No cap" helperText="Empty disables local RPM." FormHelperTextProps={{ sx: fieldHelperSx }} onChange={event => onChange({ ...value, rpm: optionalNumber(event.target.value) })} />
        <TextField fullWidth type="number" label="Tokens per minute (TPM)" value={value.tpm ?? ''} placeholder="No cap" helperText="Empty disables local TPM." FormHelperTextProps={{ sx: fieldHelperSx }} onChange={event => onChange({ ...value, tpm: optionalNumber(event.target.value) })} />
        <TextField fullWidth type="number" label="Safety margin (%)" value={Math.round(value.safetyFactor * 100)} helperText="Share of manual quota to use." FormHelperTextProps={{ sx: fieldHelperSx }} inputProps={{ min: 10, max: 100 }} onChange={event => onChange({ ...value, safetyFactor: number(event.target.value, 80) / 100 })} />
      </Box>}
    </>}
  </Stack>
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
  for (;;) {
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
  const runRef = useRef<AgentCheckpoint | null>(null)
  const savedRunRef = useRef<SavedAgentRun | null>(null)
  const [archiveReady, setArchiveReady] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  const approvalRef = useRef<((response: AiToolResponse) => void) | null>(null)
  const [runRound, setRunRound] = useState(0)
  const [autoReview, setAutoReview] = useState(false)
  const reviewedRunRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null); const requestIdRef = useRef('')
  const panelRef = useRef<HTMLDivElement>(null); const [panelPosition, setPanelPosition] = useState({ x: 0, y: 0 })
  const [connectionDraft, setConnectionDraft] = useState({ provider: 'deepseek' as ProviderKind, label: '', apiKey: '', baseUrl: '', modelIds: '', rateLimit: defaultRateLimit() })
  const [rateEditor, setRateEditor] = useState<{ connectionId: string; value: RateLimitSettings } | null>(null)

  const parametricGenerators = useMemo(() => createParametricGeneratorCatalogue(model.structuralDocument), [model])
  // Replay IDs, recent targets and named aliases are scoped to one logical conversation.
  // Replacing the conversation must also replace that in-memory tool session.
  const executor = useMemo(() => {
    if (!conversationId) throw new Error('Copilot conversation ID is required')
    return model.createAiToolExecutor(parametricGenerators)
  }, [conversationId, model, parametricGenerators])
  useEffect(() => {
    let active = true
    setArchiveReady(false)
    void Promise.all([loadCopilotArchive<Message[]>(`${conversationId}:messages`), loadCopilotArchive<SavedAgentRun>(`${conversationId}:run`)]).then(([storedMessages, storedRun]) => {
      if (!active) return
      if (storedMessages) setMessages(storedMessages)
      if (storedRun) {
        if (storedRun.run.status === 'running') storedRun.run.status = 'stopped'
        runRef.current = storedRun.run; savedRunRef.current = storedRun
        setRunRound(storedRun.run.round)
      }
    }).catch(error => { if (active) setArchiveError(`Archive unavailable: ${String(error)}`) })
      .finally(() => { if (active) setArchiveReady(true) })
    return () => { active = false }
  }, [conversationId])
  useEffect(() => {
    if (archiveReady) void saveCopilotArchive(`${conversationId}:messages`, messages).catch(error => setArchiveError(`Messages remain in this session; archive failed: ${String(error)}`))
  }, [messages, archiveReady, conversationId])
  useEffect(() => { sessionStorage.setItem(modeKey, mode) }, [mode])
  useEffect(() => { sessionStorage.setItem(conversationKey, conversationId) }, [conversationId])

  const context = () => ({ ...executor.queries.getModelSummary(), selection: executor.queries.getSelection().selection,
    sections: executor.queries.getEntities('sections'), materials: executor.queries.getEntities('materials'),
    analysis: { currentRevision: model.analysisRevision, snapshotHash: model.analysisSnapshotHash, latestRunId: model.currentAnalysisRunId ?? model.analysisRuns.latestId, archiveWarning: model.analysisArchiveError || undefined },
    capabilities: { parametricKinds: Object.keys(parametricGenerators), commonQueries: ['computed member length', 'semantic role', 'section', 'material', 'position', 'connectivity'] } })

  useEffect(() => {
    if (!open) return
    const loadConnections = async () => {
      try {
        const response = await fetch(`${apiRoot}/api/copilot/connections`, { headers: apiHeaders }); if (!response.ok) throw new Error(`Cannot load providers (${response.status})`)
        const values = await response.json() as ProviderConnection[]; setConnections(values)
        setSelectedConnectionId(currentId => {
          const selected = values.find(value => value.id === currentId) ?? values[0]
          setSelectedModel(current => selected?.models.includes(current) ? current : selected?.models[0] ?? '')
          return selected?.id ?? ''
        })
      } catch (error) { setConnectionError(error instanceof Error ? error.message : String(error)) }
    }
    void loadConnections()
  }, [open])

  const saveConnection = async () => {
    setConnectionError('')
    try {
      const response = await fetch(`${apiRoot}/api/copilot/connections`, { method: 'POST', headers: apiHeaders, body: JSON.stringify({
        provider: connectionDraft.provider, apiKey: connectionDraft.apiKey,
        ...(connectionDraft.label.trim() ? { label: connectionDraft.label.trim() } : {}), ...(connectionDraft.baseUrl.trim() ? { baseUrl: connectionDraft.baseUrl.trim() } : {}),
        modelIds: connectionDraft.modelIds.split(',').map(value => value.trim()).filter(Boolean),
        rateLimit: connectionDraft.rateLimit,
      }) }); const body = await response.json(); if (!response.ok) throw new Error(httpDetailMessage(body, `Connection failed (${response.status})`))
      const created = body as ProviderConnection; setConnections(current => [...current.filter(value => value.id !== created.id), created])
      setSelectedConnectionId(created.id); setSelectedModel(created.models[0] ?? ''); setConnectionDraft(current => ({ ...current, apiKey: '' })); setSettingsOpen(false)
    } catch (error) { setConnectionError(error instanceof Error ? error.message : String(error)) }
  }
  const removeConnection = async (id: string) => {
    await fetch(`${apiRoot}/api/copilot/connections/${encodeURIComponent(id)}`, { method: 'DELETE', headers: apiHeaders })
    const remaining = connections.filter(connection => connection.id !== id); setConnections(remaining); setSelectedConnectionId(remaining[0]?.id ?? ''); setSelectedModel(remaining[0]?.models[0] ?? '')
  }

  const updateTurnMessage = (messageId: string, patch: Partial<Message>) =>
    setMessages(current => current.map(message => message.id === messageId ? { ...message, ...patch } : message))

  const runConversation = async (text: string, logicalTurnId: string, onMutationCommitted: () => void): Promise<Exclude<CopilotTurnStatus, 'running' | 'failed'>> => {
    const previous = savedRunRef.current?.run.id === logicalTurnId ? savedRunRef.current : null
    const runMode = previous?.mode ?? mode
    const connectionId = previous?.connectionId ?? selectedConnectionId
    const modelId = previous?.modelId ?? selectedModel
    if (previous && previous.modelHash !== model.structuralDocument.getSnapshotHash()) throw new Error('Model changed since the checkpoint. Start a new request against the current model; saved calls were not replayed.')
    const controller = new AbortController(); abortRef.current = controller
    const allowedTools = [...executor.registry.list().filter(tool => isToolAllowed(runMode, tool)), AGENT_RESULT_TOOL]
    const tools = allowedTools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }))
    const history = messages.filter(message => message.role === 'user' || message.role === 'assistant').map(message => ({ role: message.role, content: message.text }))
    const run = runRef.current?.id === logicalTurnId ? runRef.current : { ...newAgentCheckpoint(text), id: logicalTurnId }
    runRef.current = run
    const message = await runAgent(run, {
      signal: controller.signal,
      checkpoint: async checkpoint => {
        setRunRound(checkpoint.round)
        const saved: SavedAgentRun = { run: checkpoint, modelHash: ['stopped', 'failed'].includes(checkpoint.status) ? savedRunRef.current?.modelHash ?? model.structuralDocument.getSnapshotHash() : model.structuralDocument.getSnapshotHash(), mode: runMode, connectionId, modelId }
        savedRunRef.current = saved
        try { await saveCopilotArchive(`${conversationId}:run`, structuredClone(saved)) }
        catch (error) { setArchiveError(`Checkpoint remains in memory; save failed: ${String(error)}`) }
      },
      plan: async checkpoint => {
        controller.signal.throwIfAborted()
        const requestId = crypto.randomUUID(); requestIdRef.current = requestId
        const revision = model.structuralDocument.revision
        setStreamingText('')
        const result = await streamTurn({ requestId, conversationId, prompt: text, mode: runMode, context: context(), history, tools,
          toolResults: agentContextResults(checkpoint.results), connectionId, model: modelId }, controller.signal,
          chunk => setStreamingText(current => current + chunk))
        controller.signal.throwIfAborted()
        setStreamingText('')
        const conflict = copilotContextConflictMessage(revision, model.structuralDocument.revision, result.contextRevision)
        if (conflict && result.finishReason !== 'cancelled') throw new Error(conflict)
        return result
      },
      execute: async providerCall => {
        controller.signal.throwIfAborted()
        if (providerCall.name === AGENT_RESULT_TOOL.name) {
          try { return { toolCallId: providerCall.id, tool: providerCall.name, ok: true, revision: model.structuralDocument.revision, data: readAgentResult(run, providerCall.arguments) } }
          catch (error) { return { toolCallId: providerCall.id, tool: providerCall.name, ok: false, revision: model.structuralDocument.revision, error: { code: 'INVALID_ARGUMENTS', message: String(error) } } }
        }
        const call = { ...providerCall, arguments: safeProviderToolArguments(providerCall.name, providerCall.arguments, runMode) }
        const response = await executor.executeAsync(call, runMode, controller.signal)
        if (response.ok && !response.undoToken && response.preview && (response.preview.requiresApproval || call.name === 'preview_transaction' || call.arguments.preview === true)) {
          const tool = call.name === 'preview_transaction' ? 'execute_transaction' : call.name
          const properties = executor.registry.get(tool)!.inputSchema.properties as Record<string, unknown>
          const args = approvedToolArguments(call.arguments, properties, response.preview.approvalToken)
          return await new Promise<AiToolResponse>((resolve, reject) => {
            const abort = () => { approvalRef.current = null; setPending(null); reject(new DOMException('Stopped', 'AbortError')) }
            approvalRef.current = value => { controller.signal.removeEventListener('abort', abort); approvalRef.current = null; resolve(value) }
            controller.signal.addEventListener('abort', abort, { once: true })
            setPending({ tool, args, preview: response.preview!, revision: response.revision, mode: runMode })
          })
        }
        return response
      },
      activity: response => {
        const refs = affectedRefs(response)
        setMessages(current => [...current, { id: crypto.randomUUID(), role: 'activity', text: activityText(response), ...(refs.length ? { affected: refs } : {}) }])
        if (response.undoToken) { setLastUndoToken(response.undoToken); onMutationCommitted() }
      },
    })
    setMessages(current => [...current, newMessage('assistant', message)])
    return 'completed'
  }

  const sendPrompt = async (text: string, retryOf?: Message) => {
    if (!text || busy || !archiveReady) return
    if (!selectedConnectionId || !selectedModel) { setSettingsOpen(true); setConnectionError('Connect a provider and select a model first.'); return }
    if (retryOf && !canRetryCopilotTurn(retryOf, busy)) return
    const logicalTurnId = retryOf?.logicalTurnId ?? crypto.randomUUID()
    const turnMessage: Message = { ...newMessage('user', text), logicalTurnId, status: 'running', retryCount: retryOf ? 1 : 0, mutationCommitted: false }
    setPrompt(''); setBusy(true); setPending(null); setMessages(current => [
      ...current.map(message => retryOf && message.id === retryOf.id ? { ...message, retryCount: 1 } : message),
      turnMessage,
    ])
    try {
      const status = await runConversation(text, logicalTurnId, () => updateTurnMessage(turnMessage.id, { mutationCommitted: true }))
      updateTurnMessage(turnMessage.id, { status })
    } catch (error) {
      updateTurnMessage(turnMessage.id, { status: (error as Error).name === 'AbortError' ? 'cancelled' : 'failed' })
      if ((error as Error).name !== 'AbortError') setMessages(current => [...current, newMessage('error', error instanceof Error ? error.message : String(error))])
    }
    finally { setBusy(false); setStreamingText(''); abortRef.current = null }
  }
  const saveRateLimit = async () => {
    if (!rateEditor) return
    setConnectionError('')
    try {
      const response = await fetch(`${apiRoot}/api/copilot/connections/${encodeURIComponent(rateEditor.connectionId)}/rate-limit`, { method: 'PATCH', headers: apiHeaders, body: JSON.stringify(rateEditor.value) })
      const body = await response.json(); if (!response.ok) throw new Error(httpDetailMessage(body, `Cannot update rate limit (${response.status})`))
      const updated = body as ProviderConnection; setConnections(current => current.map(connection => connection.id === updated.id ? updated : connection)); setRateEditor(null)
    } catch (error) { setConnectionError(error instanceof Error ? error.message : String(error)) }
  }
  const submit = (event: FormEvent) => { event.preventDefault(); const text = prompt.trim(); if (text) void sendPrompt(text) }
  const retryMessage = (message: Message) => { if (canRetryCopilotTurn(message, busy)) void sendPrompt(message.text, message) }
  const handlePromptKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || busy) return
    event.preventDefault()
    const text = prompt.trim(); if (text) void sendPrompt(text)
  }
  const stop = () => {
    abortRef.current?.abort(); if (requestIdRef.current) void fetch(`${apiRoot}/api/copilot/cancel/${encodeURIComponent(requestIdRef.current)}`, { method: 'POST', headers: apiHeaders })
    setStreamingText(''); setMessages(current => [...current, newMessage('assistant', 'Đã yêu cầu dừng. Những thay đổi đã áp dụng được giữ lại; có thể Undo hoặc tiếp tục tác vụ.')])
  }
  const applyPending = () => {
    if (!pending || !approvalRef.current) return
    const conflict = copilotPreviewConflictMessage(pending.revision, model.structuralDocument.revision)
    const response: AiToolResponse = conflict
      ? { toolCallId: crypto.randomUUID(), tool: pending.tool, ok: false, revision: model.structuralDocument.revision, error: { code: 'STALE_REVISION', message: conflict } }
      : executor.execute({ id: crypto.randomUUID(), name: pending.tool, arguments: pending.args }, pending.mode)
    approvalRef.current(response); setPending(null)
  }
  const rejectPending = () => {
    if (!pending) return
    approvalRef.current?.({ toolCallId: crypto.randomUUID(), tool: pending.tool, ok: false, revision: model.structuralDocument.revision,
      error: { code: 'USER_REJECTED', message: 'The user rejected this proposed change. Do not propose it again; explain what remains undone.' } })
    setPending(null)
  }
  const resumeRun = () => {
    const run = runRef.current
    if (!run || busy || run.status === 'completed') return
    const previous = messages.find(message => message.logicalTurnId === run.id)
    void sendPrompt(run.prompt, { ...previous, ...newMessage('user', run.prompt), logicalTurnId: run.id, status: 'failed', retryCount: 0 })
  }
  const reviewResults = () => void sendPrompt('Phân tích kết quả analysis hiện tại: dùng get_analysis_summary, truy vấn các vị trí quan trọng, giải thích chuyển vị, nội lực và phản lực. Ghi run/revision, ID, station, đơn vị và hạn chế dữ liệu. Không tự kết luận đạt tiêu chuẩn khi chưa có kiểm tra tương ứng. Trả báo cáo Markdown có bảng và các đề xuất kiểm tra tiếp.')
  useEffect(() => { void model.restoreAnalysisArchive() }, [model])
  useEffect(() => {
    const id = model.currentAnalysisRunId
    if (open && autoReview && !busy && id && reviewedRunRef.current !== id && selectedConnectionId && selectedModel) {
      reviewedRunRef.current = id
      reviewResults()
    }
    // reviewResults intentionally follows the live sendPrompt closure; the
    // stable run identity and busy flag are the scheduling boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.currentAnalysisRunId, open, autoReview, busy, selectedConnectionId, selectedModel])
  const undoAi = () => {
    if (!lastUndoToken) return
    const response = executor.execute({ id: crypto.randomUUID(), name: 'undo_last_ai_change', arguments: { undoToken: lastUndoToken } }, mode)
    setMessages(current => [...current, newMessage(response.ok ? 'activity' : 'error', response.ok ? `Undo complete · revision ${response.revision}` : response.error!.message)]); if (response.ok) setLastUndoToken('')
  }
  const clearContext = () => { runRef.current = null; savedRunRef.current = null; setConversationId(crypto.randomUUID()); setPending(null); setLastUndoToken(''); setMessages([newMessage('assistant', 'Context cleared. What would you like to inspect or model?')]) }
  const selectAffected = (refs: EntityReference[]) => model.executeCommand({ commandId: crypto.randomUUID(), type: 'SetSelection', schemaVersion: COMMAND_SCHEMA_VERSION, modelRevision: model.structuralDocument.revision, source: 'ui', payload: { entities: refs } })

  if (!open) return <Tooltip title="AI Copilot"><IconButton onClick={() => setOpen(true)} sx={{ position: 'fixed', right: 18, bottom: 38, zIndex: 1300, bgcolor: colors.accent, color: '#fff', '&:hover': { bgcolor: colors.accentHover } }}><SmartToy /></IconButton></Tooltip>
  return <Draggable nodeRef={panelRef} handle=".copilot-drag-handle" cancel="button, input, textarea, [role='button'], .MuiInputBase-root" bounds="body" position={panelPosition} onStop={(_, data) => setPanelPosition({ x: data.x, y: data.y })}>
  <Paper ref={panelRef} elevation={12} sx={{ position: 'fixed', right: 16, bottom: 36, zIndex: 1300, resize: 'both', minWidth: 360, minHeight: 400, maxWidth: '95vw', maxHeight: '95vh', width: { xs: 'calc(100vw - 24px)', sm: 620 }, height: { xs: 'min(610px, calc(100vh - 24px))', sm: 610 }, display: 'flex', flexDirection: 'column', bgcolor: colors.surface, border: `1px solid ${colors.border}`, overflow: 'hidden' }}>
    <Box className="copilot-drag-handle" title="Drag to move chat" sx={{ display: 'flex', alignItems: 'center', gap: .5, px: 1, py: .75, borderBottom: `1px solid ${colors.border}`, cursor: 'grab', userSelect: 'none', '&:active': { cursor: 'grabbing' } }}><SmartToy sx={{ color: colors.accentSoft }} /><Typography sx={{ fontWeight: 700, fontSize: 14 }}>Buckle AI</Typography>
      <Select size="small" disabled={busy} value={mode} onChange={event => setMode(event.target.value as AiMode)} sx={{ width: 104, height: 30, fontSize: 11 }}>{(['Inspect', 'Edit', 'Modeling', 'Generate', 'Agent'] as AiMode[]).map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}</Select>
      <Select size="small" disabled={busy} value={selectedConnectionId && selectedModel ? `${selectedConnectionId}|${selectedModel}` : ''} onChange={event => { const [id, ...rest] = event.target.value.split('|'); setSelectedConnectionId(id); setSelectedModel(rest.join('|')) }} displayEmpty sx={{ flex: 1, height: 30, fontSize: 11, minWidth: 0 }} renderValue={value => value ? selectedModel : 'Choose model'}>{connections.flatMap(connection => connection.models.map(modelId => <MenuItem key={`${connection.id}|${modelId}`} value={`${connection.id}|${modelId}`}>{connection.label} · {modelId}</MenuItem>))}</Select>
      <Tooltip arrow title="Configure AI providers, models and rate limits" componentsProps={{ tooltip: { sx: { maxWidth: 280, px: 1.5, py: 1, fontSize: 13 } } }}><IconButton size="small" onClick={() => { setConnectionError(''); setSettingsOpen(true) }}><Settings fontSize="small" /></IconButton></Tooltip><Tooltip title="Undo last AI change"><span><IconButton size="small" disabled={!lastUndoToken || busy} onClick={undoAi}><Undo fontSize="small" /></IconButton></span></Tooltip><IconButton size="small" onClick={() => setOpen(false)}><Close fontSize="small" /></IconButton>
    </Box>
    <Box sx={{ flex: 1, overflowY: 'auto', p: 1.25, display: 'flex', flexDirection: 'column', gap: .8 }}>{messages.map(message => message.role === 'user' ? <Box key={message.id} sx={{ alignSelf: 'flex-end', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: .2, maxWidth: '88%' }}><Box sx={{ bgcolor: colors.accentHover, color: colors.text, px: 1.1, py: .7, borderRadius: 1, fontSize: 13, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.text}</Box>{canRetryCopilotTurn(message, busy) && <Button size="small" onClick={() => retryMessage(message)} sx={{ fontSize: 10, minWidth: 0, px: .8, color: colors.textDim }}><Refresh sx={{ fontSize: 12, mr: .3 }} />Retry once</Button>}</Box> : <Box key={message.id} sx={{ alignSelf: 'flex-start', maxWidth: message.role === 'activity' ? '100%' : '88%', bgcolor: message.role === 'activity' ? colors.bg : colors.surfaceAlt, border: message.role === 'activity' ? `1px solid ${colors.border}` : undefined, color: message.role === 'error' ? colors.danger : colors.text, px: 1.1, py: .7, borderRadius: 1, fontSize: message.role === 'activity' ? 11 : 13, whiteSpace: 'pre-wrap' }}>{message.role === 'assistant' ? <MarkdownMessage text={message.text} exportable /> : message.text}{!!message.affected?.length && <Button size="small" sx={{ ml: 1, fontSize: 10 }} onClick={() => selectAffected(message.affected!)}>Select</Button>}</Box>)}
      {pending && <Box sx={{ border: `1px solid ${colors.secondary}`, borderRadius: 1, p: 1, bgcolor: colors.bg }}><Typography fontSize={12} fontWeight={700}>Proposed change</Typography><Typography fontSize={12}>Add {pending.preview.created} · Update {pending.preview.updated} · Delete {pending.preview.deleted} · Risk {pending.preview.risk}</Typography>{pending.preview.parametric && <Stack spacing={.25} mt={.5}><Typography fontSize={11}>{pending.preview.parametric.kind} · template {pending.preview.parametric.templateId}@{pending.preview.parametric.templateVersion}</Typography>{pending.preview.parametric.footprint && <Typography fontSize={11}>Size {pending.preview.parametric.footprint.size.map(value => `${Number(value.toFixed(3))} m`).join(' × ')}</Typography>}<Typography fontSize={11}>Sections {pending.preview.parametric.sectionIds.join(', ') || 'none'} · Loads {pending.preview.parametric.loadCount} · Supports {pending.preview.parametric.supportCount} · Render/analysis {pending.preview.parametric.estimatedCost.render}/{pending.preview.parametric.estimatedCost.analysis}</Typography>{pending.preview.parametric.defaultsApplied.length > 0 && <Typography fontSize={11} color={colors.textDim}>Defaults: {pending.preview.parametric.defaultsApplied.join(', ')}</Typography>}{pending.preview.parametric.warnings.map(warning => <Typography key={warning} fontSize={11} color={colors.secondary}>{warning}</Typography>)}</Stack>}<Stack direction="row" spacing={1} mt={1}><Button size="small" variant="contained" onClick={applyPending}>Apply</Button><Button size="small" onClick={rejectPending}>Reject</Button></Stack></Box>}
      {streamingText && <Box sx={{ alignSelf: 'flex-start', maxWidth: '88%', bgcolor: colors.surfaceAlt, px: 1.1, py: .7, borderRadius: 1, fontSize: 13, whiteSpace: 'pre-wrap' }}><MarkdownMessage text={streamingText} /></Box>}
      {busy && <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={16} /><Typography fontSize={11}>{pending ? 'Waiting for approval…' : `Running · round ${runRound} · no step limit`}</Typography></Stack>}
    </Box>
    {archiveError && <Typography sx={{ px: 1, color: 'warning.main', fontSize: 11 }}>{archiveError}</Typography>}
    <Stack direction="row" spacing={.5} sx={{ px: 1, flexWrap: 'wrap' }}>
      <Button size="small" disabled={busy || model.analysisRevision === null} onClick={reviewResults}>Đánh giá result</Button>
      <Button size="small" color={autoReview ? 'primary' : 'inherit'} onClick={() => setAutoReview(value => !value)}>Auto review: {autoReview ? 'On' : 'Off'}</Button>
      {runRef.current && ['stopped', 'failed'].includes(runRef.current.status) && <Button size="small" disabled={busy} onClick={resumeRun}>Continue task</Button>}
      <Tooltip title={executor.registry.list().filter(tool => isToolAllowed(mode, tool)).map(tool => tool.name).join(', ')}><Button size="small">{executor.registry.list().filter(tool => isToolAllowed(mode, tool)).length + 1} tools</Button></Tooltip>
    </Stack>
    <Box component="form" onSubmit={submit} sx={{ p: 1, borderTop: `1px solid ${colors.border}` }}><Stack direction="row" spacing={1}><TextField value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={handlePromptKeyDown} disabled={busy} size="small" fullWidth multiline maxRows={3} placeholder={mode === 'Inspect' ? 'Tìm các member thép dài dưới 5 m…' : 'Nhập yêu cầu mô hình…'} inputProps={{ 'aria-label': 'Copilot prompt' }} />{busy ? <IconButton onClick={stop} color="error"><Stop /></IconButton> : <IconButton type="submit" disabled={!prompt.trim() || !archiveReady} color="primary"><Send /></IconButton>}</Stack><Stack direction="row" justifyContent="space-between" alignItems="center" mt={.5}><Typography fontSize={10} color={colors.textFaint}>{mode} · Z-up · m · kN</Typography><Button size="small" disabled={busy} onClick={clearContext}>Clear context</Button></Stack></Box>
    <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="md" fullWidth PaperProps={{ sx: { width: { xs: 'calc(100% - 24px)', sm: 760, md: 920 }, maxWidth: 'none', maxHeight: 'calc(100% - 32px)', backgroundImage: 'none' } }}>
      <DialogTitle sx={{ px: { xs: 2, sm: 3 }, py: 2.25, borderBottom: `1px solid ${colors.border}` }}><Stack direction="row" alignItems="center" spacing={1.25}><Box sx={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 1.25, bgcolor: colors.accentHover }}><Settings sx={{ fontSize: 21 }} /></Box><Box sx={{ flex: 1 }}><Typography fontSize={18} fontWeight={750}>AI provider settings</Typography><Typography mt={.25} fontSize={12.5} color={colors.textDim}>Manage provider connections, available models and outbound request limits.</Typography></Box><IconButton aria-label="Close provider settings" onClick={() => setSettingsOpen(false)}><Close /></IconButton></Stack></DialogTitle>
      <DialogContent sx={{ px: { xs: 2, sm: 3 }, py: '24px !important', bgcolor: colors.surface }}><Stack spacing={3}>
        <Box component="section"><Stack direction="row" alignItems="center" mb={1.25}><Typography fontSize={15} fontWeight={700}>Existing connections</Typography><SettingHelp text="Each connection has an independent rate-limit policy. Use Tune to change it without re-entering the API key." /></Stack>
          {connections.length === 0 ? <Box sx={{ px: 2, py: 3, textAlign: 'center', border: `1px dashed ${colors.borderDark}`, borderRadius: 1.5, bgcolor: colors.bg }}><Typography fontSize={13} color={colors.textDim}>No provider connected yet. Add one below to start using Buckle AI.</Typography></Box> : <Stack spacing={1.25}>{connections.map(connection => <Box key={connection.id} sx={{ p: 1.75, border: `1px solid ${colors.border}`, bgcolor: colors.surfaceAlt, borderRadius: 1.5 }}><Stack direction={{ xs: 'column', sm: 'row' }} gap={1.25} alignItems={{ xs: 'stretch', sm: 'center' }}><Box sx={{ flex: 1, minWidth: 0 }}><Stack direction="row" alignItems="center" spacing={1}><Typography fontSize={14} fontWeight={700}>{connection.label}</Typography><Chip size="small" label={connection.rateLimit.mode} color={connection.rateLimit.mode === 'disabled' ? 'default' : 'primary'} sx={{ height: 22, textTransform: 'capitalize' }} /></Stack><Typography mt={.45} fontSize={12} color={colors.textDim}>{connection.models.length} models · {connection.keyHint === 'local' ? 'local runtime · no API key' : `key ${connection.keyHint}`} · concurrency {connection.rateLimit.maxConcurrent}</Typography></Box><Stack direction="row" spacing={.75} justifyContent="flex-end"><Button variant="outlined" startIcon={<Tune />} onClick={() => setRateEditor({ connectionId: connection.id, value: { ...connection.rateLimit } })}>Tune limits</Button><Tooltip arrow title="Remove this provider connection" componentsProps={{ tooltip: { sx: { fontSize: 13, px: 1.25, py: .8 } } }}><IconButton aria-label={`Remove ${connection.label}`} onClick={() => void removeConnection(connection.id)} sx={{ border: `1px solid ${colors.border}` }}><DeleteOutline /></IconButton></Tooltip></Stack></Stack>{rateEditor?.connectionId === connection.id && <Stack spacing={1.5} mt={2}><RateLimitFields value={rateEditor.value} onChange={value => setRateEditor({ connectionId: connection.id, value })} /><Stack direction="row" spacing={1} justifyContent="flex-end"><Button onClick={() => setRateEditor(null)}>Cancel</Button><Button variant="contained" onClick={() => void saveRateLimit()}>Save limits</Button></Stack></Stack>}</Box>)}</Stack>}
        </Box>
        <Box component="section" sx={{ pt: 2.5, borderTop: `1px solid ${colors.border}` }}><Box mb={2}><Typography fontSize={15} fontWeight={700}>Add a provider connection</Typography><Typography mt={.4} fontSize={12.5} color={colors.textDim}>API keys stay in backend memory and are never exposed in browser responses.</Typography></Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.75 }}>
            <FormControl fullWidth><InputLabel>Provider</InputLabel><Select label="Provider" value={connectionDraft.provider} onChange={event => { const provider = event.target.value as ProviderKind; setConnectionDraft(current => ({ ...current, provider, baseUrl: isLocalProvider(provider) ? localPresetBaseUrl[provider] ?? '' : current.baseUrl, rateLimit: defaultRateLimit() })) }}>{(['openai', 'deepseek', 'anthropic', 'gemini', 'openrouter', 'nvidia', 'groq', 'compatible', 'ollama', 'lmstudio', 'local'] as ProviderKind[]).map(value => <MenuItem key={value} value={value}>{providerLabel(value)}</MenuItem>)}</Select></FormControl>
            <TextField fullWidth label="Connection name" placeholder="Optional friendly name" value={connectionDraft.label} onChange={event => setConnectionDraft(current => ({ ...current, label: event.target.value }))} />
            <TextField fullWidth label={isLocalProvider(connectionDraft.provider) ? 'API key (optional)' : 'API key'} type="password" autoComplete="new-password" placeholder={isLocalProvider(connectionDraft.provider) ? 'Leave empty for local runtimes' : 'Paste the provider API key'} value={connectionDraft.apiKey} onChange={event => setConnectionDraft(current => ({ ...current, apiKey: event.target.value }))} />
            <TextField fullWidth label="Model IDs" placeholder="Auto-discover, or comma-separated IDs" value={connectionDraft.modelIds} onChange={event => setConnectionDraft(current => ({ ...current, modelIds: event.target.value }))} />
            {(connectionDraft.provider === 'compatible' || isLocalProvider(connectionDraft.provider)) && <TextField fullWidth label={connectionDraft.provider === 'compatible' ? 'HTTPS base URL' : 'Base URL'} placeholder={connectionDraft.provider === 'compatible' ? 'https://provider.example/v1' : 'http://localhost:11434/v1'} value={connectionDraft.baseUrl} onChange={event => setConnectionDraft(current => ({ ...current, baseUrl: event.target.value }))} helperText={isLocalProvider(connectionDraft.provider) ? 'Must be reachable from the backend process, e.g. http://localhost:11434/v1 (Ollama) or http://localhost:1234/v1 (LM Studio).' : undefined} sx={{ gridColumn: { sm: '1 / -1' } }} />}
          </Box>
          {isLocalProvider(connectionDraft.provider) && <Typography mt={1} fontSize={12} color={colors.textDim}>Start the runtime first — e.g. <code>ollama serve</code> or LM Studio → Developer → Start Server. Model IDs such as <code>llama3.2:3b</code> auto-discover from the runtime; Edit/Agent modes need a model with tool-calling support.</Typography>}
          <Box mt={2}><RateLimitFields value={connectionDraft.rateLimit} onChange={rateLimit => setConnectionDraft(current => ({ ...current, rateLimit }))} /></Box>
        </Box>
        {connectionError && <Box sx={{ p: 1.5, border: `1px solid ${colors.danger}`, borderRadius: 1, bgcolor: 'rgba(229,72,77,.08)' }}><Typography color={colors.danger} fontSize={13}>{connectionError}</Typography></Box>}
      </Stack></DialogContent><DialogActions sx={{ px: { xs: 2, sm: 3 }, py: 2, borderTop: `1px solid ${colors.border}` }}><Button onClick={() => setSettingsOpen(false)}>Close</Button><Button size="large" variant="contained" disabled={(!connectionDraft.apiKey.trim() && !isLocalProvider(connectionDraft.provider)) || (connectionDraft.provider === 'local' && !connectionDraft.baseUrl.trim())} onClick={() => void saveConnection()}>Connect provider</Button></DialogActions>
    </Dialog>
  </Paper>
  </Draggable>
})

export default CopilotPanel
