import type { ButtonItem } from './adapters/types.js'
import type { AgentServerRequest } from './agents/types.js'
import type { StoredCodexPendingRequest } from './state.js'

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return null }
  return recordValue(parsed) ?? null
}

function questionRecords(params: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(params.questions) ? params.questions.flatMap(item => recordValue(item) ?? []) : []
}

function questionId(question: Record<string, unknown> | undefined, fallback: string): string {
  return typeof question?.id === 'string' && question.id ? question.id : fallback
}

function questionText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function fallbackText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

function answerString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value)
  try { return JSON.stringify(value) } catch { return '' }
}

function numericFormValue(text: string, integer = false): number | string {
  const trimmed = text.trim()
  if (!trimmed) return trimmed
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) return trimmed
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return trimmed
  if (integer && !Number.isInteger(value)) return trimmed
  return value
}

export type CodexQuestionOption = { label: string; description?: string }

export function codexQuestionOptions(params: Record<string, unknown>): CodexQuestionOption[] {
  const questions = questionRecords(params)
  if (questions.length !== 1) return []
  const options = Array.isArray(questions[0]?.options) ? questions[0].options : []
  return options.flatMap(option => {
    const record = recordValue(option)
    const label = typeof record?.label === 'string' ? record.label : ''
    if (!label) return []
    const description = typeof record?.description === 'string' ? record.description : undefined
    return [{ label, description }]
  })
}

export function codexAvailableDecisionNames(params: Record<string, unknown>): Set<string> | null {
  const available = params.availableDecisions
  if (!Array.isArray(available)) return null
  const names = new Set<string>()
  for (const item of available) {
    if (typeof item === 'string') names.add(item)
    else {
      const record = recordValue(item)
      const [name] = record ? Object.keys(record) : []
      if (name) names.add(name)
    }
  }
  return names
}

function codexAvailableDecisionValue(params: Record<string, unknown>, name: string): unknown {
  const available = params.availableDecisions
  if (!Array.isArray(available)) return undefined
  for (const item of available) {
    if (item === name) return name
    const record = recordValue(item)
    if (record && name in record) return record[name]
  }
  return undefined
}

function codexAmendmentPayload(params: Record<string, unknown>, name: string, payloadKey: string): Record<string, unknown> | null {
  const payload = recordValue(codexAvailableDecisionValue(params, name))
  return payload && recordValue(payload[payloadKey]) ? payload : null
}

function codexDecisionAvailable(params: Record<string, unknown>, name: string): boolean {
  const available = codexAvailableDecisionNames(params)
  return !available || available.has(name)
}

function codexExplicitDecisionAvailable(params: Record<string, unknown>, name: string): boolean {
  const available = codexAvailableDecisionNames(params)
  return !!available && available.has(name)
}

function codexDecisionActionName(action: string): string {
  if (action === 'approve') return 'accept'
  if (action === 'approve_session') return 'acceptForSession'
  if (action === 'approve_exec_policy') return 'acceptWithExecpolicyAmendment'
  if (action === 'approve_network_policy') return 'applyNetworkPolicyAmendment'
  if (action === 'deny') return 'decline'
  if (action === 'abort') return 'cancel'
  return action
}

export function codexMcpMeta(params: Record<string, unknown>): Record<string, unknown> | undefined {
  return recordValue(params._meta) ?? recordValue(params.meta)
}

export function codexMcpPersistChoices(params: Record<string, unknown>): Set<string> {
  const persist = codexMcpMeta(params)?.persist
  const values = Array.isArray(persist) ? persist : persist ? [persist] : []
  return new Set(values.filter((value): value is string => typeof value === 'string' && !!value))
}

export function isCodexMcpToolApproval(params: Record<string, unknown>): boolean {
  return codexMcpMeta(params)?.codex_approval_kind === 'mcp_tool_call'
}

export function codexRequestActionAllowed(request: Pick<AgentServerRequest, 'method' | 'params'>, action: string): boolean {
  if (action === 'answer') return request.method === 'item/tool/requestUserInput' || request.method === 'mcpServer/elicitation/request'
  if (request.method === 'item/tool/requestUserInput') return action === 'abort'
  if (request.method === 'item/permissions/requestApproval') return action === 'approve' || action === 'deny'
  if (request.method === 'mcpServer/elicitation/request' && !isCodexMcpToolApproval(request.params)) return action === 'deny' || action === 'abort'
  if (request.method === 'mcpServer/elicitation/request') {
    if (action === 'approve_session') {
      const persist = codexMcpPersistChoices(request.params)
      return persist.has('session') || persist.has('always')
    }
    return action === 'approve' || action === 'deny' || action === 'abort'
  }
  if (request.method === 'item/commandExecution/requestApproval') {
    return (action === 'approve_exec_policy' || action === 'approve_network_policy') ? codexExplicitDecisionAvailable(request.params, codexDecisionActionName(action)) : codexDecisionAvailable(request.params, codexDecisionActionName(action))
  }
  if (request.method === 'item/fileChange/requestApproval') {
    if (action === 'approve_exec_policy' || action === 'approve_network_policy') return false
    return codexDecisionAvailable(request.params, codexDecisionActionName(action))
  }
  if (request.method === 'execCommandApproval' || request.method === 'applyPatchApproval') {
    if (action === 'approve_session') return codexDecisionAvailable(request.params, 'approved_for_session')
    return action === 'approve' || action === 'deny' || action === 'abort'
  }
  return action === 'deny' || action === 'abort'
}

export function codexDecisionButtons(requestId: string, allowSession: boolean): ButtonItem[] {
  const buttons: ButtonItem[] = [{ text: '✅ Allow', data: `cxreq:${requestId}:approve` }]
  if (allowSession) buttons.push({ text: '✅ Allow Session', data: `cxreq:${requestId}:approve_session` })
  buttons.push({ text: '❌ Deny', data: `cxreq:${requestId}:deny` })
  buttons.push({ text: '🛑 Abort', data: `cxreq:${requestId}:abort` })
  return buttons
}

export function codexApprovalButtons(request: Pick<AgentServerRequest, 'requestId' | 'params'>): ButtonItem[] {
  const buttons: ButtonItem[] = []
  if (codexDecisionAvailable(request.params, 'accept')) buttons.push({ text: '✅ Allow', data: `cxreq:${request.requestId}:approve` })
  if (codexDecisionAvailable(request.params, 'acceptForSession')) buttons.push({ text: '✅ Allow Session', data: `cxreq:${request.requestId}:approve_session` })
  if (codexExplicitDecisionAvailable(request.params, 'acceptWithExecpolicyAmendment')) buttons.push({ text: '✅ Allow Policy', data: `cxreq:${request.requestId}:approve_exec_policy` })
  if (codexExplicitDecisionAvailable(request.params, 'applyNetworkPolicyAmendment')) buttons.push({ text: '✅ Allow Network', data: `cxreq:${request.requestId}:approve_network_policy` })
  if (codexDecisionAvailable(request.params, 'decline')) buttons.push({ text: '❌ Deny', data: `cxreq:${request.requestId}:deny` })
  if (codexDecisionAvailable(request.params, 'cancel')) buttons.push({ text: '🛑 Abort', data: `cxreq:${request.requestId}:abort` })
  return buttons.length ? buttons : [{ text: '❌ Deny', data: `cxreq:${request.requestId}:deny` }]
}

export function codexOptionButtons(requestId: string, options: Array<{ label: string }>): ButtonItem[] {
  return [
    ...options.slice(0, 8).map((option, i) => ({ text: option.label, data: `cxreq:${requestId}:opt:${i}` })),
    { text: '🛑 Cancel', data: `cxreq:${requestId}:abort` },
  ]
}

export function codexPendingRequestButtons(request: AgentServerRequest): ButtonItem[] {
  const params = request.params
  if (request.method === 'item/tool/requestUserInput') {
    const options = codexQuestionOptions(params)
    return options.length ? codexOptionButtons(request.requestId, options) : [{ text: '🛑 Cancel', data: `cxreq:${request.requestId}:abort` }]
  }
  if (request.method === 'item/permissions/requestApproval') {
    return [
      { text: '✅ Allow', data: `cxreq:${request.requestId}:approve` },
      { text: '❌ Deny', data: `cxreq:${request.requestId}:deny` },
    ]
  }
  if (request.method === 'mcpServer/elicitation/request' && !isCodexMcpToolApproval(params)) {
    return [
      { text: '❌ Decline', data: `cxreq:${request.requestId}:deny` },
      { text: '🛑 Cancel', data: `cxreq:${request.requestId}:abort` },
    ]
  }
  if (request.method === 'item/commandExecution/requestApproval' || request.method === 'item/fileChange/requestApproval' || request.method === 'execCommandApproval' || request.method === 'applyPatchApproval') return codexApprovalButtons(request)
  return [
    { text: '❌ Deny', data: `cxreq:${request.requestId}:deny` },
    { text: '🛑 Abort', data: `cxreq:${request.requestId}:abort` },
  ]
}

function truncateForPrompt(value: unknown, max = 1200): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (!text) return ''
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

export function summarizeCodexRequest(request: AgentServerRequest): { text: string; buttons: ButtonItem[] } | null {
  const params = request.params
  const method = request.method
  const title = method.split('/').slice(-1)[0] ?? method
  const reason = typeof params.reason === 'string' && params.reason ? `\nReason: ${params.reason}` : ''
  const cwd = typeof params.cwd === 'string' && params.cwd ? `\nCwd: \`${params.cwd}\`` : ''
  const command = typeof params.command === 'string' && params.command ? `\n\`\`\`\n${truncateForPrompt(params.command, 900)}\n\`\`\`` : ''
  const grantRoot = typeof params.grantRoot === 'string' && params.grantRoot ? `\nGrant root: \`${params.grantRoot}\`` : ''
  const execPolicyAmendment = params.proposedExecpolicyAmendment ? `\nExec policy amendment:\n\`\`\`json\n${truncateForPrompt(params.proposedExecpolicyAmendment, 900)}\n\`\`\`` : ''
  const networkPolicyAmendments = params.proposedNetworkPolicyAmendments ? `\nNetwork policy amendments:\n\`\`\`json\n${truncateForPrompt(params.proposedNetworkPolicyAmendments, 900)}\n\`\`\`` : ''
  const details = !command && !cwd && !reason && !grantRoot && !execPolicyAmendment && !networkPolicyAmendments ? `\n\`\`\`json\n${truncateForPrompt(params, 900)}\n\`\`\`` : `${cwd}${reason}${grantRoot}${command}${execPolicyAmendment}${networkPolicyAmendments}`
  if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') {
    return { text: `🔐 Requests command approval${details}`, buttons: codexApprovalButtons(request) }
  }
  if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') {
    return { text: `🔐 Requests file-change approval${details}`, buttons: codexApprovalButtons(request) }
  }
  if (method === 'item/permissions/requestApproval') {
    return {
      text: `🔐 Requests broader permissions${details}`,
      buttons: [
        { text: '✅ Allow', data: `cxreq:${request.requestId}:approve` },
        { text: '❌ Deny', data: `cxreq:${request.requestId}:deny` },
      ],
    }
  }
  if (method === 'item/tool/requestUserInput') {
    const questions = questionRecords(params)
    const lines = questions.map((question, i) => {
      const options = codexQuestionOptions({ questions: [question] })
      const optionText = options.length ? `\n${options.map((option, n) => `  ${n + 1}. ${option.label}${option.description ? ` — ${option.description}` : ''}`).join('\n')}` : ''
      return `${i + 1}. ${questionText(question.header, questionId(question, 'Question'))}: ${questionText(question.question)}${optionText}`
    }).join('\n')
    const options = codexQuestionOptions(params)
    return {
      text: `❓ Asks for input. Reply to this message with the answer${questions.length > 1 ? 's as JSON like `{ "id": ["answer"] }` or one answer per line' : ''}.\n${lines || `\`\`\`json\n${truncateForPrompt(params, 1200)}\n\`\`\``}`,
      buttons: options.length ? codexOptionButtons(request.requestId, options) : [{ text: '🛑 Cancel', data: `cxreq:${request.requestId}:abort` }],
    }
  }
  if (method === 'mcpServer/elicitation/request') {
    const mode = typeof params.mode === 'string' ? params.mode : ''
    const message = typeof params.message === 'string' ? params.message : title
    const schema = params.requestedSchema ? `\nSchema:\n\`\`\`json\n${truncateForPrompt(params.requestedSchema, 1200)}\n\`\`\`` : ''
    const url = typeof params.url === 'string' ? `\nURL: ${params.url}` : ''
    if (isCodexMcpToolApproval(params)) {
      const meta = codexMcpMeta(params)
      const toolParams = meta?.tool_params_display ?? meta?.tool_params
      const toolDetails = toolParams ? `\n\`\`\`json\n${truncateForPrompt(toolParams, 1200)}\n\`\`\`` : ''
      const persistChoices = codexMcpPersistChoices(params)
      const allowPersist = persistChoices.has('session') || persistChoices.has('always')
      return {
        text: `🔐 MCP (${fallbackText(params.serverName, 'server')}) requests tool approval.\n${message}${toolDetails}`,
        buttons: codexDecisionButtons(request.requestId, allowPersist),
      }
    }
    return {
      text: `❓ MCP (${fallbackText(params.serverName, 'server')}) requests ${mode || 'input'}. Reply to this message with ${mode === 'form' ? 'a JSON object for the form' : 'the result/confirmation after opening the URL'}.\n${message}${url}${schema}`,
      buttons: [
        { text: '❌ Decline', data: `cxreq:${request.requestId}:deny` },
        { text: '🛑 Cancel', data: `cxreq:${request.requestId}:abort` },
      ],
    }
  }
  return {
    text: `❓ Needs interactive input (${title}). Reply in plain English; JSON is optional if the request needs structured data. Use Deny/Abort to unblock safely.
\`\`\`json
${truncateForPrompt(params, 1400)}
\`\`\``,
    buttons: [
      { text: '❌ Deny', data: `cxreq:${request.requestId}:deny` },
      { text: '🛑 Abort', data: `cxreq:${request.requestId}:abort` },
    ],
  }
}

export function codexApprovalResult(method: string, decision: string, params: Record<string, unknown> = {}): Record<string, unknown> | null {
  if (!['approve', 'approve_session', 'approve_exec_policy', 'approve_network_policy', 'deny', 'abort'].includes(decision)) return null
  const denied = decision === 'deny'
  const abort = decision === 'abort'
  if ((method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') && !codexRequestActionAllowed({ method, params }, decision)) return null
  if ((method === 'execCommandApproval' || method === 'applyPatchApproval') && !codexRequestActionAllowed({ method, params }, decision)) return null
  if (method === 'item/permissions/requestApproval') {
    if (decision === 'approve_session' || decision === 'approve_exec_policy' || decision === 'approve_network_policy' || abort) return null
    return { permissions: denied ? {} : recordValue(params.permissions) ?? {}, scope: 'turn' }
  }
  if (method === 'item/commandExecution/requestApproval') {
    if (decision === 'approve_exec_policy') {
      const payload = codexAmendmentPayload(params, 'acceptWithExecpolicyAmendment', 'execpolicy_amendment')
      return payload ? { decision: { acceptWithExecpolicyAmendment: payload } } : null
    }
    if (decision === 'approve_network_policy') {
      const payload = codexAmendmentPayload(params, 'applyNetworkPolicyAmendment', 'network_policy_amendment')
      return payload ? { decision: { applyNetworkPolicyAmendment: payload } } : null
    }
    return { decision: decision === 'approve_session' ? 'acceptForSession' : denied ? 'decline' : abort ? 'cancel' : 'accept' }
  }
  if (method === 'item/fileChange/requestApproval') {
    if (decision === 'approve_exec_policy' || decision === 'approve_network_policy') return null
    return { decision: decision === 'approve_session' ? 'acceptForSession' : denied ? 'decline' : abort ? 'cancel' : 'accept' }
  }
  if (method === 'execCommandApproval' || method === 'applyPatchApproval') {
    if (decision === 'approve_exec_policy' || decision === 'approve_network_policy') return null
    return { decision: decision === 'approve_session' ? 'approved_for_session' : denied ? 'denied' : abort ? 'abort' : 'approved' }
  }
  if (method === 'mcpServer/elicitation/request') {
    if (decision === 'approve_session' || decision === 'approve_exec_policy' || decision === 'approve_network_policy') return null
    return { action: denied ? 'decline' : abort ? 'cancel' : 'accept', content: denied || abort ? null : {}, _meta: null }
  }
  if (method === 'item/tool/requestUserInput') {
    return abort ? { answers: {} } : null
  }
  if (!denied && !abort) return null
  return { decision: abort ? 'cancel' : 'decline' }
}

export function codexUserInputResult(params: Record<string, unknown>, text: string): Record<string, unknown> {
  const questions = questionRecords(params)
  const parsed = parseJsonObject(text)
  const answers: Record<string, { answers: string[] }> = {}
  if (parsed) {
    for (const question of questions) {
      const id = questionId(question, '')
      if (!id || !(id in parsed)) continue
      const value = parsed[id]
      answers[id] = { answers: Array.isArray(value) ? value.map(answerString) : [answerString(value)] }
    }
    if (Object.keys(answers).length > 0) return { answers }
  }
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  if (questions.length <= 1) {
    const id = questionId(questions[0], 'answer')
    answers[id] = { answers: [text.trim()] }
  } else {
    questions.forEach((question, index) => {
      const id = questionId(question, `q${index + 1}`)
      answers[id] = { answers: [lines[index] ?? ''] }
    })
  }
  return { answers }
}

export function codexOptionInputResult(params: Record<string, unknown>, optionIndex: number): Record<string, unknown> | null {
  const question = questionRecords(params)[0]
  const options = Array.isArray(question?.options) ? question.options.flatMap(item => recordValue(item) ?? []) : []
  if (!Number.isSafeInteger(optionIndex) || optionIndex < 0 || optionIndex >= options.length) return null
  const option = recordValue(options[optionIndex])
  const label = typeof option?.label === 'string' ? option.label : ''
  if (!label) return null
  const id = questionId(question, 'answer')
  return { answers: { [id]: { answers: [label] } } }
}

export function coerceMcpFormContent(schema: Record<string, unknown> | undefined, text: string): unknown {
  const parsed = parseJsonObject(text)
  if (parsed) return parsed
  const properties = recordValue(schema?.properties) ?? {}
  const keys = Object.keys(properties)
  if (keys.length === 1) {
    const key = keys[0]
    const property = recordValue(properties[key])
    const type = property?.type
    if (type === 'boolean') return { [key]: /^(true|yes|y|1)$/i.test(text.trim()) }
    if (type === 'number' || type === 'integer') return { [key]: numericFormValue(text, type === 'integer') }
    return { [key]: text.trim() }
  }
  return { value: text.trim() }
}

export function codexTextResponseResult(pending: StoredCodexPendingRequest, text: string): Record<string, unknown> {
  if (pending.method === 'item/tool/requestUserInput') return codexUserInputResult(pending.params, text)
  if (pending.method === 'mcpServer/elicitation/request') {
    const mode = typeof pending.params.mode === 'string' ? pending.params.mode : ''
    const requestedSchema = recordValue(pending.params.requestedSchema)
    if (mode === 'form') return { action: 'accept', content: coerceMcpFormContent(requestedSchema, text), _meta: null }
    return { action: 'accept', content: { response: text.trim() }, _meta: null }
  }
  const parsed = parseJsonObject(text)
  if (parsed) return parsed
  return { action: 'accept', content: { response: text.trim() }, value: text.trim() }
}
