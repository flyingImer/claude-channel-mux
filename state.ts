import { readFileSync } from 'fs'

export function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function readJsonValueFile(path: string): unknown {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return undefined }
}

export function readJsonRecordFile(path: string): Record<string, unknown> {
  return recordValue(readJsonValueFile(path)) ?? {}
}


export type StoredCodexPendingRequest = {
  sessionId: string
  requestId: string
  method: string
  channelKey: string
  channelId: string
  messageId?: string
  messageIds?: string[]
  threadId?: string
  params: Record<string, unknown>
  createdAt: number
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = [...new Set(value.filter((item): item is string => typeof item === 'string' && !!item))]
  return strings.length ? strings : undefined
}

export function stringRecord(value: unknown): Record<string, string> {
  const record = recordValue(value)
  if (!record) return {}
  return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1]))
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function jsonValue(value: unknown): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') return finiteNumber(value)
  if (Array.isArray(value)) return value.map(item => jsonValue(item) ?? null)
  return jsonRecord(value)
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  const record = recordValue(value)
  if (!record) return undefined
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(record)) {
    const json = jsonValue(item)
    if (json !== undefined) result[key] = json
  }
  return result
}


export type PersistedCodexPendingRequest = Omit<StoredCodexPendingRequest, 'params'>

export function persistedCodexPendingRequests(requests: Map<string, StoredCodexPendingRequest>): Record<string, PersistedCodexPendingRequest> {
  const entries: Array<[string, PersistedCodexPendingRequest]> = []
  for (const [key, request] of requests) {
    const { params: _params, ...persisted } = request
    entries.push([key, persisted])
  }
  return Object.fromEntries(entries)
}

export function codexPendingRequestsFromJson(value: unknown): Map<string, StoredCodexPendingRequest> {
  const record = recordValue(value)
  if (!record) return new Map()
  const entries: Array<[string, StoredCodexPendingRequest]> = []
  for (const [key, raw] of Object.entries(record)) {
    const item = recordValue(raw)
    const params = jsonRecord(item?.params) ?? {}
    const sessionId = stringValue(item?.sessionId)
    const requestId = stringValue(item?.requestId)
    const method = stringValue(item?.method)
    const channelKey = stringValue(item?.channelKey)
    const channelId = stringValue(item?.channelId)
    const createdAt = finiteNumber(item?.createdAt)
    const messageId = stringValue(item?.messageId)
    const messageIds = stringList(item?.messageIds)
    const threadId = stringValue(item?.threadId)
    if (!item || !sessionId || !requestId || !method || !channelKey || !channelId || createdAt === undefined) continue
    entries.push([key, {
      sessionId,
      requestId,
      method,
      channelKey,
      channelId,
      ...(messageId ? { messageId } : {}),
      ...(messageIds ? { messageIds } : {}),
      ...(threadId ? { threadId } : {}),
      params,
      createdAt,
    }])
  }
  return new Map(entries)
}


export type StoredTranscriptDeliveries = Record<string, Record<string, { channels: string[]; ts: number }>>

export function transcriptDeliveriesFromJson(value: unknown): StoredTranscriptDeliveries {
  const record = recordValue(value)
  if (!record) return {}
  const result: StoredTranscriptDeliveries = {}
  for (const [uuid, rawByKey] of Object.entries(record)) {
    const byKey = recordValue(rawByKey)
    if (!byKey) continue
    const cleanByKey: Record<string, { channels: string[]; ts: number }> = {}
    for (const [key, rawEntry] of Object.entries(byKey)) {
      const entry = recordValue(rawEntry)
      const channels = stringList(entry?.channels)
      const ts = finiteNumber(entry?.ts)
      if (!entry || !channels || ts === undefined) continue
      cleanByKey[key] = { channels, ts }
    }
    if (Object.keys(cleanByKey).length) result[uuid] = cleanByKey
  }
  return result
}
