import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import type { ArchiveRoomResult, CreateRoomWithBotInvitedResult } from '../adapters/types.js'

export type CreateIntent = 'create_new_room' | 'repair_existing_room' | 'created'

export type WorkerState = {
  workerTaskId: string
  desiredRoomName: string
  topic?: string
  createIntent: CreateIntent
  createStarted: boolean
  roomId?: string
  roomName?: string
  createAttempts: CreateRoomWithBotInvitedResult[]
  output: {
    captured: boolean
    consumed: boolean
    captureId?: string
  }
  archive: {
    requested: boolean
    result?: ArchiveRoomResult
  }
}

export type OrchestrationProfile = {
  version: 1
  orchestratorRoom?: string
  activeOrchestratorSession?: {
    room?: string
    agentSessionId?: string
    lastSeenAt?: string
  }
  workers: Record<string, WorkerState>
  captures: Record<string, WorkerCapture>
  recallPackets: Record<string, RecallPacket>
  inbox: Record<string, InboxItem>
}

export type WorkerCapture = {
  captureId: string
  workerTaskId: string
  path: string
  consumed: boolean
}

export type RecallPacket = {
  recallId: string
  workerTaskId?: string
  question: string
  status: 'open' | 'answered'
}

export type InboxItem = {
  path: string
  processed: boolean
}

export type WorkerAssignment = {
  workerTaskId: string
  desiredRoomName: string
  topic?: string
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function createIntentValue(value: unknown): CreateIntent {
  return value === 'repair_existing_room' || value === 'created' ? value : 'create_new_room'
}

function createAttemptList(value: unknown): CreateRoomWithBotInvitedResult[] {
  return Array.isArray(value) ? value.filter((item): item is CreateRoomWithBotInvitedResult => !!recordValue(item)) : []
}

function createResultRecord(result: CreateRoomWithBotInvitedResult): Record<string, unknown> {
  return result as unknown as Record<string, unknown>
}

function workerFromJson(workerTaskId: string, value: unknown): WorkerState | undefined {
  const record = recordValue(value)
  if (!record) return undefined
  const desiredRoomName = stringValue(record.desiredRoomName)
  if (!desiredRoomName) return undefined
  const output = recordValue(record.output)
  const archive = recordValue(record.archive)
  return {
    workerTaskId,
    desiredRoomName,
    ...(stringValue(record.topic) ? { topic: stringValue(record.topic) } : {}),
    createIntent: createIntentValue(record.createIntent),
    createStarted: booleanValue(record.createStarted) ?? false,
    ...(stringValue(record.roomId) ? { roomId: stringValue(record.roomId) } : {}),
    ...(stringValue(record.roomName) ? { roomName: stringValue(record.roomName) } : {}),
    createAttempts: createAttemptList(record.createAttempts),
    output: {
      captured: booleanValue(output?.captured) ?? false,
      consumed: booleanValue(output?.consumed) ?? false,
      ...(stringValue(output?.captureId) ? { captureId: stringValue(output?.captureId) } : {}),
    },
    archive: {
      requested: booleanValue(archive?.requested) ?? false,
      ...(recordValue(archive?.result) ? { result: archive?.result as ArchiveRoomResult } : {}),
    },
  }
}

export function emptyOrchestrationProfile(): OrchestrationProfile {
  return { version: 1, workers: {}, captures: {}, recallPackets: {}, inbox: {} }
}

export function loadOrchestrationProfile(path: string): OrchestrationProfile {
  if (!existsSync(path)) return emptyOrchestrationProfile()
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return emptyOrchestrationProfile()
  }
  const record = recordValue(parsed)
  if (!record) return emptyOrchestrationProfile()
  const workersRecord = recordValue(record.workers) ?? {}
  const workers: Record<string, WorkerState> = {}
  for (const [workerTaskId, raw] of Object.entries(workersRecord)) {
    const worker = workerFromJson(workerTaskId, raw)
    if (worker) workers[workerTaskId] = worker
  }
  const captures = Object.fromEntries(Object.entries(recordValue(record.captures) ?? {}).flatMap(([captureId, raw]) => {
    const item = recordValue(raw)
    const workerTaskId = stringValue(item?.workerTaskId)
    const path = stringValue(item?.path)
    if (!workerTaskId || !path) return []
    return [[captureId, { captureId, workerTaskId, path, consumed: booleanValue(item?.consumed) ?? false }]]
  }))
  const recallPackets: Record<string, RecallPacket> = Object.fromEntries(Object.entries(recordValue(record.recallPackets) ?? {}).flatMap(([recallId, raw]) => {
    const item = recordValue(raw)
    const question = stringValue(item?.question)
    if (!question) return []
    const packet: RecallPacket = { recallId, ...(stringValue(item?.workerTaskId) ? { workerTaskId: stringValue(item?.workerTaskId) } : {}), question, status: item?.status === 'answered' ? 'answered' : 'open' }
    return [[recallId, packet]]
  }))
  const inbox = Object.fromEntries(Object.entries(recordValue(record.inbox) ?? {}).flatMap(([path, raw]) => {
    const item = recordValue(raw)
    return stringValue(item?.path) ? [[path, { path: stringValue(item?.path)!, processed: booleanValue(item?.processed) ?? false }]] : []
  }))
  const profile: OrchestrationProfile = { version: 1, workers, captures, recallPackets, inbox }
  if (stringValue(record.orchestratorRoom)) profile.orchestratorRoom = stringValue(record.orchestratorRoom)
  if (recordValue(record.activeOrchestratorSession)) profile.activeOrchestratorSession = record.activeOrchestratorSession as OrchestrationProfile['activeOrchestratorSession']
  return profile
}

export function saveOrchestrationProfile(path: string, profile: OrchestrationProfile): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(profile, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, path)
}

function nextDesiredName(profile: OrchestrationProfile, desiredRoomName: string, workerTaskId: string): string {
  const existing = Object.values(profile.workers).find(worker => worker.workerTaskId !== workerTaskId && worker.desiredRoomName === desiredRoomName)
  return existing ? `${desiredRoomName}-${workerTaskId}` : desiredRoomName
}

export function assignWorkerRoom(profile: OrchestrationProfile, assignment: WorkerAssignment): WorkerState {
  const existing = profile.workers[assignment.workerTaskId]
  if (existing) {
    if (existing.desiredRoomName !== assignment.desiredRoomName) throw new Error('desired_room_name is immutable after creation starts')
    return existing
  }
  const desiredRoomName = nextDesiredName(profile, assignment.desiredRoomName, assignment.workerTaskId)
  const worker: WorkerState = {
    workerTaskId: assignment.workerTaskId,
    desiredRoomName,
    ...(assignment.topic ? { topic: assignment.topic } : {}),
    createIntent: 'create_new_room',
    createStarted: true,
    createAttempts: [],
    output: { captured: false, consumed: false },
    archive: { requested: false },
  }
  profile.workers[assignment.workerTaskId] = worker
  return worker
}

export function recordCreateResult(profile: OrchestrationProfile, workerTaskId: string, result: CreateRoomWithBotInvitedResult): WorkerState {
  const worker = profile.workers[workerTaskId]
  if (!worker) throw new Error(`unknown worker_task_id ${workerTaskId}`)
  worker.createAttempts.push(result)
  if (result.ok) {
    worker.createIntent = 'created'
    worker.roomId = result.roomId
    worker.roomName = result.roomName
  } else if (result.operation === 'create_room_with_bot_invited' && createResultRecord(result).code === 'room_exists' && stringValue(createResultRecord(result).roomId)) {
    worker.createIntent = 'repair_existing_room'
    worker.roomId = stringValue(createResultRecord(result).roomId)
    if (stringValue(createResultRecord(result).roomName)) worker.roomName = stringValue(createResultRecord(result).roomName)
  }
  return worker
}

export function markOutputConsumed(profile: OrchestrationProfile, workerTaskId: string, captureId: string): WorkerState {
  const worker = profile.workers[workerTaskId]
  if (!worker) throw new Error(`unknown worker_task_id ${workerTaskId}`)
  if (profile.captures[captureId]) profile.captures[captureId].consumed = true
  worker.output = { captured: true, consumed: true, captureId }
  return worker
}

export function recordWorkerCapture(profile: OrchestrationProfile, capture: Omit<WorkerCapture, 'consumed'> & { consumed?: boolean }): WorkerCapture {
  const item: WorkerCapture = { captureId: capture.captureId, workerTaskId: capture.workerTaskId, path: capture.path, consumed: capture.consumed ?? false }
  profile.captures[item.captureId] = item
  return item
}

export function addRecallPacket(profile: OrchestrationProfile, packet: Omit<RecallPacket, 'status'> & { status?: RecallPacket['status'] }): RecallPacket {
  const item: RecallPacket = { recallId: packet.recallId, ...(packet.workerTaskId ? { workerTaskId: packet.workerTaskId } : {}), question: packet.question, status: packet.status ?? 'open' }
  profile.recallPackets[item.recallId] = item
  return item
}

export function addInboxItem(profile: OrchestrationProfile, item: InboxItem | { path: string }): InboxItem {
  const inboxItem: InboxItem = { path: item.path, processed: 'processed' in item ? item.processed : false }
  profile.inbox[inboxItem.path] = inboxItem
  return inboxItem
}

export function markInboxProcessed(profile: OrchestrationProfile, path: string): InboxItem {
  const item = profile.inbox[path] ?? addInboxItem(profile, { path })
  item.processed = true
  return item
}

export function markArchiveRequested(profile: OrchestrationProfile, workerTaskId: string): WorkerState {
  const worker = profile.workers[workerTaskId]
  if (!worker) throw new Error(`unknown worker_task_id ${workerTaskId}`)
  if (!worker.output.consumed) throw new Error('worker output must be consumed before archive is requested')
  worker.archive.requested = true
  return worker
}

export function recordArchiveResult(profile: OrchestrationProfile, workerTaskId: string, result: ArchiveRoomResult): WorkerState {
  const worker = profile.workers[workerTaskId]
  if (!worker) throw new Error(`unknown worker_task_id ${workerTaskId}`)
  worker.archive.result = result
  return worker
}
