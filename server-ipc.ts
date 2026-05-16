export type DaemonPermissionResponse = { request_id: string; behavior: 'allow' | 'deny' }
export type DaemonInboundMessage = { content: string; meta: Record<string, string> }
export type DaemonToolResult = { callId: string; result: string }
export type DaemonToolError = { callId: string; error: string }

export function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function daemonFrameFromLine(data: string): Record<string, unknown> | undefined {
  let parsed: unknown
  try { parsed = JSON.parse(data) } catch { return undefined }
  return recordValue(parsed)
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function daemonPermissionResponse(msg: Record<string, unknown>): DaemonPermissionResponse | undefined {
  const behavior = msg.behavior === 'allow' || msg.behavior === 'deny' ? msg.behavior : undefined
  const requestId = stringValue(msg.request_id)
  return requestId && behavior ? { request_id: requestId, behavior } : undefined
}

export function daemonInboundMessage(msg: Record<string, unknown>): DaemonInboundMessage | undefined {
  const content = stringValue(msg.content)
  const meta = recordValue(msg.meta)
  if (!content || !meta) return undefined
  return { content, meta: Object.fromEntries(Object.entries(meta).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) }
}

export function daemonToolResult(msg: Record<string, unknown>): DaemonToolResult | undefined {
  const callId = stringValue(msg.callId)
  return callId ? { callId, result: stringValue(msg.result) } : undefined
}

export function daemonToolError(msg: Record<string, unknown>): DaemonToolError | undefined {
  const callId = stringValue(msg.callId)
  return callId ? { callId, error: stringValue(msg.error) || 'daemon tool error' } : undefined
}

export function toolArguments(value: unknown): Record<string, unknown> {
  return recordValue(value) ?? {}
}
