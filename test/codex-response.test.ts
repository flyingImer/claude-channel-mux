import { test, expect } from 'bun:test'
import { codexApprovalResult, codexOptionInputResult, codexPendingRequestButtons, codexRequestActionAllowed, codexTextResponseResult, codexUserInputResult, coerceMcpFormContent, parseJsonObject, summarizeCodexRequest } from '../codex-response.ts'
import type { StoredCodexPendingRequest } from '../state.ts'

test('parseJsonObject accepts only JSON objects', () => {
  expect(parseJsonObject('{"ok":true}')).toEqual({ ok: true })
  expect(parseJsonObject('[1]')).toBeNull()
  expect(parseJsonObject('not json')).toBeNull()
})

test('codexUserInputResult maps JSON answers by question id or falls back to text lines', () => {
  const params = { questions: [{ id: 'first' }, { id: 'second' }] }
  expect(codexUserInputResult(params, '{"first":"a","second":["b","c"]}')).toEqual({ answers: { first: { answers: ['a'] }, second: { answers: ['b', 'c'] } } })
  expect(codexUserInputResult(params, '{"first":{"nested":true},"second":[1,{"x":2}]}')).toEqual({ answers: { first: { answers: ['{"nested":true}'] }, second: { answers: ['1', '{"x":2}'] } } })
  expect(codexUserInputResult(params, 'one\ntwo')).toEqual({ answers: { first: { answers: ['one'] }, second: { answers: ['two'] } } })
  expect(codexUserInputResult({}, 'hello')).toEqual({ answers: { answer: { answers: ['hello'] } } })
})

test('codexOptionInputResult chooses labels from typed options', () => {
  expect(codexOptionInputResult({ questions: [{ id: 'choice', options: [{ label: 'A' }, { label: 'B' }] }] }, 1)).toEqual({ answers: { choice: { answers: ['B'] } } })
  expect(codexOptionInputResult({ questions: [{ id: 'choice', options: [{ label: 'A' }] }] }, 9)).toBeNull()
  expect(codexOptionInputResult({ questions: [{ id: 'choice', options: [{ label: 'A' }] }] }, NaN)).toBeNull()
  expect(codexOptionInputResult({ questions: [{ id: 'choice', options: [{ label: 123 }] }] }, 0)).toBeNull()
})

test('coerceMcpFormContent parses JSON or coerces single-property schemas', () => {
  expect(coerceMcpFormContent(undefined, '{"x":1}')).toEqual({ x: 1 })
  expect(coerceMcpFormContent({ properties: { ok: { type: 'boolean' } } }, 'yes')).toEqual({ ok: true })
  expect(coerceMcpFormContent({ properties: { count: { type: 'integer' } } }, '42')).toEqual({ count: 42 })
  expect(coerceMcpFormContent({ properties: { count: { type: 'integer' } } }, 'not-a-number')).toEqual({ count: 'not-a-number' })
  expect(coerceMcpFormContent({ properties: { count: { type: 'integer' } } }, '42.5')).toEqual({ count: '42.5' })
  expect(coerceMcpFormContent({ properties: { count: { type: 'integer' } } }, '')).toEqual({ count: '' })
  expect(coerceMcpFormContent({ properties: { amount: { type: 'number' } } }, '.5')).toEqual({ amount: 0.5 })
  expect(coerceMcpFormContent({ properties: { name: { type: 'string' } } }, ' Ada ')).toEqual({ name: 'Ada' })
  expect(coerceMcpFormContent({ properties: { a: {}, b: {} } }, 'value')).toEqual({ value: 'value' })
})

test('codexTextResponseResult returns method-specific payloads', () => {
  const base = { sessionId: 's', requestId: 'r', channelKey: 'slack:C', channelId: 'C', params: {}, createdAt: 1 }
  expect(codexTextResponseResult({ ...base, method: 'item/tool/requestUserInput', params: { questions: [{ id: 'q' }] } }, 'answer')).toEqual({ answers: { q: { answers: ['answer'] } } })
  expect(codexTextResponseResult({ ...base, method: 'mcpServer/elicitation/request', params: { mode: 'form', requestedSchema: { properties: { ok: { type: 'boolean' } } } } }, 'true')).toEqual({ action: 'accept', content: { ok: true }, _meta: null })
  expect(codexTextResponseResult({ ...base, method: 'mcpServer/elicitation/request', params: { mode: { bad: true }, requestedSchema: { properties: { ok: { type: 'boolean' } } } } }, 'true')).toEqual({ action: 'accept', content: { response: 'true' }, _meta: null })
  expect(codexTextResponseResult({ ...base, method: 'other' } as StoredCodexPendingRequest, '{"decision":"ok"}')).toEqual({ decision: 'ok' })
})

test('summarizeCodexRequest preserves approval and input UX', () => {
  const command = summarizeCodexRequest({ requestId: 'r1', method: 'item/commandExecution/requestApproval', params: { command: 'echo hi', cwd: '/repo', availableDecisions: ['acceptForSession'] } })
  expect(command?.text).toContain('Requests command approval')
  expect(command?.text).toContain('Cwd: `/repo`')
  expect(command?.buttons).toContainEqual({ text: '✅ Allow Session', data: 'cxreq:r1:approve_session' })

  const amendmentPrompt = summarizeCodexRequest({ requestId: 'r5', method: 'item/commandExecution/requestApproval', params: { command: 'curl example.com', proposedExecpolicyAmendment: { match: 'curl' }, proposedNetworkPolicyAmendments: [{ host: 'example.com' }], availableDecisions: [{ acceptWithExecpolicyAmendment: { execpolicy_amendment: { match: 'curl' } } }, { applyNetworkPolicyAmendment: { network_policy_amendment: { host: 'example.com' } } }, 'decline'] } })
  expect(amendmentPrompt?.text).toContain('Exec policy amendment:')
  expect(amendmentPrompt?.text).toContain('Network policy amendments:')
  expect(amendmentPrompt?.text).toContain('example.com')
  expect(amendmentPrompt?.buttons).toContainEqual({ text: '✅ Allow Policy', data: 'cxreq:r5:approve_exec_policy' })
  expect(amendmentPrompt?.buttons).toContainEqual({ text: '✅ Allow Network', data: 'cxreq:r5:approve_network_policy' })

  const input = summarizeCodexRequest({ requestId: 'r2', method: 'item/tool/requestUserInput', params: { questions: [{ id: 'choice', header: 'Pick', question: 'Choose?', options: [{ label: 'A', description: 'Alpha' }] }] } })
  expect(input?.text).toContain('Pick: Choose?')
  expect(input?.text).toContain('1. A — Alpha')
  expect(input?.buttons).toEqual([{ text: 'A', data: 'cxreq:r2:opt:0' }, { text: '🛑 Cancel', data: 'cxreq:r2:abort' }])

  const malformedInput = summarizeCodexRequest({ requestId: 'r3', method: 'item/tool/requestUserInput', params: { questions: [{ id: 99, header: { bad: true }, question: { bad: true }, options: [{ label: 123 }] }] } })
  expect(malformedInput?.text).not.toContain('123')
  expect(malformedInput?.text).not.toContain('[object Object]')
  expect(malformedInput?.buttons).toEqual([{ text: '🛑 Cancel', data: 'cxreq:r3:abort' }])

  const malformedMcp = summarizeCodexRequest({ requestId: 'r4', method: 'mcpServer/elicitation/request', params: { serverName: { bad: true }, mode: { bad: true }, message: 'Need value' } })
  expect(malformedMcp?.text).toContain('MCP (server) requests input')
  expect(malformedMcp?.text).not.toContain('[object Object]')
  expect(command?.text).not.toContain('**🟢 Codex**')
  expect(input?.text).not.toContain('**🟢 Codex**')
})

test('codexPendingRequestButtons and approval results fail closed', () => {
  expect(codexPendingRequestButtons({ requestId: 'p1', method: 'item/permissions/requestApproval', params: {} })).toEqual([
    { text: '✅ Allow', data: 'cxreq:p1:approve' },
    { text: '❌ Deny', data: 'cxreq:p1:deny' },
  ])
  expect(codexPendingRequestButtons({ requestId: 'p2', method: 'mcpServer/elicitation/request', params: { mode: 'form' } })).toEqual([
    { text: '❌ Decline', data: 'cxreq:p2:deny' },
    { text: '🛑 Cancel', data: 'cxreq:p2:abort' },
  ])
  expect(codexPendingRequestButtons({ requestId: 'p3', method: 'mcpServer/elicitation/request', params: { availableDecisions: ['accept'], _meta: { codex_approval_kind: 'mcp_tool_call', persist: [123] } } })).not.toContainEqual({ text: '✅ Allow Session', data: 'cxreq:p3:approve_session' })
  expect(codexPendingRequestButtons({ requestId: 'p4', method: 'item/commandExecution/requestApproval', params: {} }).map(button => button.data)).toEqual(['cxreq:p4:approve', 'cxreq:p4:approve_session', 'cxreq:p4:deny', 'cxreq:p4:abort'])
  expect(codexPendingRequestButtons({ requestId: 'p5', method: 'item/commandExecution/requestApproval', params: { proposedExecpolicyAmendment: { match: 'echo' } } }).map(button => button.data)).not.toContain('cxreq:p5:approve_exec_policy')
  expect(codexPendingRequestButtons({ requestId: 'p6', method: 'unknown/request', params: {} })).toEqual([
    { text: '❌ Deny', data: 'cxreq:p6:deny' },
    { text: '🛑 Abort', data: 'cxreq:p6:abort' },
  ])
  expect(codexApprovalResult('item/permissions/requestApproval', 'approve', { permissions: { network: true } })).toEqual({ permissions: { network: true }, scope: 'turn' })
  expect(codexApprovalResult('item/permissions/requestApproval', 'deny', { permissions: { network: true } })).toEqual({ permissions: {}, scope: 'turn' })
  expect(codexApprovalResult('item/permissions/requestApproval', 'approve_session', { permissions: { network: true } })).toBeNull()
  expect(codexApprovalResult('item/commandExecution/requestApproval', 'approve', { availableDecisions: ['acceptForSession'] })).toBeNull()
  expect(codexApprovalResult('item/commandExecution/requestApproval', 'approve_session', { availableDecisions: ['acceptForSession'] })).toEqual({ decision: 'acceptForSession' })
  expect(codexApprovalResult('execCommandApproval', 'approve_session', { availableDecisions: ['approved'] })).toBeNull()
  expect(codexApprovalResult('item/tool/requestUserInput', 'approve')).toBeNull()
  expect(codexApprovalResult('item/tool/requestUserInput', 'abort')).toEqual({ answers: {} })
  expect(codexApprovalResult('mcpServer/elicitation/request', 'approve_session')).toBeNull()
  expect(codexApprovalResult('execCommandApproval', 'approve_session')).toEqual({ decision: 'approved_for_session' })
  expect(codexApprovalResult('mcpServer/elicitation/request', 'abort')).toEqual({ action: 'cancel', content: null, _meta: null })
  expect(codexApprovalResult('execCommandApproval', 'weird')).toBeNull()
  expect(codexApprovalResult('unknown/request', 'approve')).toBeNull()
  expect(codexApprovalResult('unknown/request', 'approve_session')).toBeNull()
  expect(codexApprovalResult('unknown/request', 'deny')).toEqual({ decision: 'decline' })
  expect(codexApprovalResult('unknown/request', 'abort')).toEqual({ decision: 'cancel' })
})

test('codexRequestActionAllowed centralizes button and nav request safety', () => {
  const command = { requestId: 'r1', method: 'item/commandExecution/requestApproval', params: { availableDecisions: ['acceptForSession'] } }
  const permission = { requestId: 'r2', method: 'item/permissions/requestApproval', params: { permissions: { network: true } } }
  const input = { requestId: 'r3', method: 'item/tool/requestUserInput', params: { questions: [{ id: 'q', options: [{ label: 'A' }] }] } }
  const mcpForm = { requestId: 'r4', method: 'mcpServer/elicitation/request', params: { mode: 'form' } }
  const mcpTool = { requestId: 'r5', method: 'mcpServer/elicitation/request', params: { _meta: { codex_approval_kind: 'mcp_tool_call', persist: ['session'] } } }

  expect(codexPendingRequestButtons(command).map(button => button.data)).toEqual(['cxreq:r1:approve_session'])
  expect(codexRequestActionAllowed(command, 'approve')).toBe(false)
  expect(codexRequestActionAllowed(command, 'approve_session')).toBe(true)
  expect(codexRequestActionAllowed({ method: 'item/commandExecution/requestApproval', params: { proposedExecpolicyAmendment: { match: 'echo' } } }, 'approve_exec_policy')).toBe(false)
  expect(codexRequestActionAllowed({ method: 'item/fileChange/requestApproval', params: { availableDecisions: [{ acceptWithExecpolicyAmendment: {} }] } }, 'approve_exec_policy')).toBe(false)
  expect(codexApprovalResult('item/fileChange/requestApproval', 'approve_exec_policy', { availableDecisions: [{ acceptWithExecpolicyAmendment: {} }] })).toBeNull()
  expect(codexApprovalResult('item/commandExecution/requestApproval', 'approve_exec_policy', { availableDecisions: [{ acceptWithExecpolicyAmendment: {} }] })).toBeNull()
  expect(codexApprovalResult('item/commandExecution/requestApproval', 'approve_network_policy', { availableDecisions: [{ applyNetworkPolicyAmendment: {} }] })).toBeNull()
  expect(codexApprovalResult('execCommandApproval', 'approve_exec_policy')).toBeNull()
  expect(codexRequestActionAllowed(permission, 'approve_session')).toBe(false)
  expect(codexRequestActionAllowed(input, 'approve')).toBe(false)
  expect(codexRequestActionAllowed(input, 'answer')).toBe(true)
  expect(codexRequestActionAllowed(mcpForm, 'approve')).toBe(false)
  expect(codexRequestActionAllowed(mcpForm, 'answer')).toBe(true)
  expect(codexRequestActionAllowed(mcpTool, 'approve_session')).toBe(true)
  expect(codexRequestActionAllowed(mcpTool, 'bogus')).toBe(false)
  const amendment = { requestId: 'r7', method: 'item/commandExecution/requestApproval', params: { proposedExecpolicyAmendment: { match: 'echo' }, availableDecisions: [{ acceptWithExecpolicyAmendment: { execpolicy_amendment: { match: 'echo' } } }, 'decline'] } }
  expect(codexPendingRequestButtons(amendment).map(button => button.data)).toEqual(['cxreq:r7:approve_exec_policy', 'cxreq:r7:deny'])
  expect(codexRequestActionAllowed(amendment, 'approve_exec_policy')).toBe(true)
  expect(codexRequestActionAllowed(amendment, 'approve')).toBe(false)
  expect(codexApprovalResult('item/commandExecution/requestApproval', 'approve_exec_policy', amendment.params)).toEqual({ decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: { match: 'echo' } } } })
  expect(codexRequestActionAllowed({ method: 'unknown/request', params: {} }, 'approve')).toBe(false)
  expect(codexRequestActionAllowed({ method: 'unknown/request', params: {} }, 'deny')).toBe(true)
})
