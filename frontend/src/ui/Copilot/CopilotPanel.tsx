import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Stack, TextField,
  Tooltip, Typography,
} from '@mui/material'
import { Close, DeleteOutline, Send, Settings, SmartToy, Undo } from '@mui/icons-material'
import { observer } from 'mobx-react-lite'
import { useModel } from '../../model/Context'
import { colors } from '../../theme'
import type { LocalReference, StructuralCommandOperation } from '../../core/structural'

type Message = { role: 'user' | 'assistant' | 'error'; text: string }
type PlanNode = { alias: string; name?: string; x: number; y: number; z: number }
type PlanMember = { alias: string; label?: string; node_i: number | string; node_j: number | string; section_id: number }
type PlanResponse =
  | { kind: 'clarification'; message: string }
  | { kind: 'transaction'; message: string; plan: { nodes: PlanNode[]; members: PlanMember[] } }
type ProviderKind = 'openai' | 'deepseek' | 'anthropic' | 'gemini' | 'openrouter' | 'compatible'
type ProviderConnection = {
  id: string; provider: ProviderKind; label: string; baseUrl: string; models: string[]; keyHint: string
}

const apiRoot = (import.meta.env.VITE_BACKEND_SERVER || 'http://localhost:8000').replace(/\/$/, '')
const sessionKey = 'buckle.copilot.session'
const copilotSessionId = sessionStorage.getItem(sessionKey) ?? crypto.randomUUID()
sessionStorage.setItem(sessionKey, copilotSessionId)
const apiHeaders = { 'Content-Type': 'application/json', 'X-Copilot-Session': copilotSessionId }
const reference = (value: number | string): LocalReference =>
  typeof value === 'number' ? value : { alias: value }

const CopilotPanel = observer(() => {
  const model = useModel()
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [connections, setConnections] = useState<ProviderConnection[]>([])
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [connectionError, setConnectionError] = useState('')
  const [connectionDraft, setConnectionDraft] = useState({
    provider: 'deepseek' as ProviderKind, label: '', apiKey: '', baseUrl: '', modelIds: '',
  })
  const [messages, setMessages] = useState<Message[]>([{
    role: 'assistant',
    text: 'POC: tôi có thể tạo node và member thẳng. Tọa độ dùng mét, hệ Z-up.',
  }])

  const context = useMemo(() => ({
    revision: model.structuralDocument.revision,
    nodeCount: model.structuralDocument.nodes.size,
    memberCount: model.structuralDocument.members.size,
    nodeIds: [...model.structuralDocument.nodes.keys()],
    sections: [...model.structuralDocument.sections.values()].map(section => ({
      id: section.id, name: section.name, type: section.type,
    })),
  }), [model, model.structuralDocument.revision])

  const loadConnections = async () => {
    try {
      const response = await fetch(`${apiRoot}/api/copilot/connections`, { headers: apiHeaders })
      if (!response.ok) throw new Error(`Cannot load providers (${response.status})`)
      const values = await response.json() as ProviderConnection[]
      setConnections(values)
      const selected = values.find(value => value.id === selectedConnectionId) ?? values[0]
      if (selected) {
        setSelectedConnectionId(selected.id)
        setSelectedModel(current => selected.models.includes(current) ? current : selected.models[0] ?? '')
      } else {
        setSelectedConnectionId('')
        setSelectedModel('')
      }
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => { if (open) void loadConnections() }, [open])

  const chooseModel = (value: string) => {
    const separator = value.indexOf('|')
    setSelectedConnectionId(value.slice(0, separator))
    setSelectedModel(value.slice(separator + 1))
  }

  const saveConnection = async () => {
    setConnectionError('')
    try {
      const response = await fetch(`${apiRoot}/api/copilot/connections`, {
        method: 'POST', headers: apiHeaders,
        body: JSON.stringify({
          provider: connectionDraft.provider,
          apiKey: connectionDraft.apiKey,
          ...(connectionDraft.label.trim() ? { label: connectionDraft.label.trim() } : {}),
          ...(connectionDraft.baseUrl.trim() ? { baseUrl: connectionDraft.baseUrl.trim() } : {}),
          modelIds: connectionDraft.modelIds.split(',').map(value => value.trim()).filter(Boolean),
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.detail || `Connection failed (${response.status})`)
      const created = body as ProviderConnection
      setConnections(current => [...current.filter(value => value.id !== created.id), created])
      setSelectedConnectionId(created.id)
      setSelectedModel(created.models[0] ?? '')
      setConnectionDraft(current => ({ ...current, apiKey: '' }))
      setSettingsOpen(false)
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : String(error))
    }
  }

  const removeConnection = async (id: string) => {
    await fetch(`${apiRoot}/api/copilot/connections/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: apiHeaders,
    })
    const remaining = connections.filter(connection => connection.id !== id)
    setConnections(remaining)
    const next = remaining[0]
    setSelectedConnectionId(next?.id ?? '')
    setSelectedModel(next?.models[0] ?? '')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const text = prompt.trim()
    if (!text || busy) return
    if (!selectedConnectionId || !selectedModel) {
      setSettingsOpen(true)
      setConnectionError('Connect a provider and select a model first.')
      return
    }
    setPrompt('')
    setBusy(true)
    setMessages(current => [...current, { role: 'user', text }])
    try {
      const response = await fetch(`${apiRoot}/api/copilot/plan`, {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify({
          prompt: text, context, connectionId: selectedConnectionId, model: selectedModel,
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.detail || `Copilot request failed (${response.status})`)
      const result = body as PlanResponse
      if (result.kind === 'clarification') {
        setMessages(current => [...current, { role: 'assistant', text: result.message }])
        return
      }
      const operations: StructuralCommandOperation[] = []
      if (result.plan.nodes.length) operations.push({
        type: 'CreateNodes',
        payload: { nodes: result.plan.nodes.map(node => ({
          alias: node.alias, name: node.name, position: [node.x, node.y, node.z],
        })) },
      })
      if (result.plan.members.length) operations.push({
        type: 'CreateMembers',
        payload: { members: result.plan.members.map(member => ({
          alias: member.alias,
          label: member.label,
          nodeI: reference(member.node_i),
          nodeJ: reference(member.node_j),
          sectionId: member.section_id,
        })) },
      })
      if (!operations.length) throw new Error('Copilot returned an empty transaction')
      const applied = model.executeCommand({
        commandId: crypto.randomUUID(),
        transactionId: crypto.randomUUID(),
        type: 'Transaction',
        schemaVersion: '1.0',
        modelRevision: model.structuralDocument.revision,
        source: 'ai',
        payload: { operations },
      })
      const ids = Object.entries(applied.aliases).map(([alias, id]) => `${alias}=${id}`).join(', ')
      setMessages(current => [...current, {
        role: 'assistant',
        text: `${result.message}. Revision ${applied.revision}${ids ? ` · ${ids}` : ''}`,
      }])
    } catch (error) {
      setMessages(current => [...current, {
        role: 'error', text: error instanceof Error ? error.message : String(error),
      }])
    } finally {
      setBusy(false)
    }
  }

  if (!open) return (
    <Tooltip title="AI Copilot POC">
      <IconButton onClick={() => setOpen(true)} sx={{
        position: 'fixed', right: 18, bottom: 38, zIndex: 1300,
        bgcolor: colors.accent, color: '#fff', '&:hover': { bgcolor: colors.accentHover },
      }}><SmartToy /></IconButton>
    </Tooltip>
  )

  return (
    <Paper elevation={12} sx={{
      position: 'fixed', right: 16, bottom: 36, zIndex: 1300, width: 360, height: 480,
      display: 'flex', flexDirection: 'column', bgcolor: colors.surface,
      border: `1px solid ${colors.border}`, overflow: 'hidden',
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 1, borderBottom: `1px solid ${colors.border}` }}>
        <SmartToy sx={{ color: colors.accentSoft, mr: 1 }} />
        <Typography sx={{ fontWeight: 700, fontSize: 14, mr: 1 }}>Buckle AI</Typography>
        <Select
          size="small" value={selectedConnectionId && selectedModel ? `${selectedConnectionId}|${selectedModel}` : ''}
          onChange={event => chooseModel(event.target.value)} displayEmpty
          sx={{ flex: 1, height: 30, fontSize: 12, minWidth: 0 }}
          renderValue={value => value ? selectedModel : 'Choose model'}
        >
          {connections.flatMap(connection => connection.models.map(modelId => (
            <MenuItem key={`${connection.id}|${modelId}`} value={`${connection.id}|${modelId}`}>
              {connection.label} · {modelId}
            </MenuItem>
          )))}
        </Select>
        <Tooltip title="Provider settings"><IconButton size="small" onClick={() => { setConnectionError(''); setSettingsOpen(true) }}><Settings fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Undo last model change"><span><IconButton size="small" disabled={!model.commandGateway.canUndo || busy} onClick={() => model.undoCommand()}><Undo fontSize="small" /></IconButton></span></Tooltip>
        <IconButton size="small" onClick={() => setOpen(false)}><Close fontSize="small" /></IconButton>
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {messages.map((message, index) => (
          <Box key={index} sx={{
            alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%',
            bgcolor: message.role === 'user' ? colors.accentHover : colors.surfaceAlt,
            color: message.role === 'error' ? colors.danger : colors.text,
            px: 1.25, py: .8, borderRadius: 1, fontSize: 13, whiteSpace: 'pre-wrap',
          }}>{message.text}</Box>
        ))}
        {busy && <CircularProgress size={18} sx={{ m: 1 }} />}
      </Box>
      <Box component="form" onSubmit={submit} sx={{ display: 'flex', gap: 1, p: 1, borderTop: `1px solid ${colors.border}` }}>
        <TextField
          value={prompt} onChange={event => setPrompt(event.target.value)} disabled={busy}
          size="small" fullWidth placeholder="Tạo 2 node và nối bằng member…"
          inputProps={{ 'aria-label': 'Copilot prompt' }}
        />
        <IconButton type="submit" disabled={busy || !prompt.trim()} color="primary"><Send /></IconButton>
      </Box>
      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>AI provider connections</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            {connections.map(connection => (
              <Box key={connection.id} sx={{ display: 'flex', alignItems: 'center', p: 1, bgcolor: colors.surfaceAlt, borderRadius: 1 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography fontSize={13} fontWeight={700}>{connection.label}</Typography>
                  <Typography fontSize={11} color={colors.textDim}>{connection.models.length} models · {connection.keyHint}</Typography>
                </Box>
                <IconButton size="small" onClick={() => void removeConnection(connection.id)}><DeleteOutline fontSize="small" /></IconButton>
              </Box>
            ))}
            <FormControl size="small" fullWidth>
              <InputLabel>Provider</InputLabel>
              <Select label="Provider" value={connectionDraft.provider} onChange={event => setConnectionDraft(current => ({ ...current, provider: event.target.value as ProviderKind }))}>
                <MenuItem value="openai">OpenAI</MenuItem>
                <MenuItem value="deepseek">DeepSeek</MenuItem>
                <MenuItem value="anthropic">Anthropic</MenuItem>
                <MenuItem value="gemini">Google Gemini</MenuItem>
                <MenuItem value="openrouter">OpenRouter</MenuItem>
                <MenuItem value="compatible">OpenAI-compatible</MenuItem>
              </Select>
            </FormControl>
            <TextField size="small" label="Connection name (optional)" value={connectionDraft.label} onChange={event => setConnectionDraft(current => ({ ...current, label: event.target.value }))} />
            <TextField size="small" label="API key" type="password" autoComplete="new-password" value={connectionDraft.apiKey} onChange={event => setConnectionDraft(current => ({ ...current, apiKey: event.target.value }))} />
            {connectionDraft.provider === 'compatible' && <TextField size="small" label="HTTPS base URL" placeholder="https://provider.example/v1" value={connectionDraft.baseUrl} onChange={event => setConnectionDraft(current => ({ ...current, baseUrl: event.target.value }))} />}
            <TextField size="small" label="Model IDs (optional, comma-separated)" helperText="Leave empty to discover models from the provider." value={connectionDraft.modelIds} onChange={event => setConnectionDraft(current => ({ ...current, modelIds: event.target.value }))} />
            {connectionError && <Typography color="error" fontSize={12}>{connectionError}</Typography>}
            <Typography color={colors.textFaint} fontSize={11}>Keys are kept only in backend memory for this POC and disappear when the server restarts.</Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!connectionDraft.apiKey.trim()} onClick={() => void saveConnection()}>Connect</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
})

export default CopilotPanel
