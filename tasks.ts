import { basename } from 'path'

export type TaskStatus = 'pending' | 'in_progress' | 'completed'
export type TaskSnapshotItem = {
  id: string
  text: string
  activeText?: string
  status: TaskStatus
  blockedBy: string[]
}

export function normalizeTaskStatus(value: unknown): TaskStatus | null {
  return value === 'pending' || value === 'in_progress' || value === 'completed' ? value : null
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function taskSnapshotSortNumber(id: string): number | undefined {
  if (!/^\d+$/.test(id)) return undefined
  const value = Number(id)
  return Number.isSafeInteger(value) ? value : undefined
}

export function compareTaskSnapshotItems(a: TaskSnapshotItem, b: TaskSnapshotItem): number {
  const an = taskSnapshotSortNumber(a.id)
  const bn = taskSnapshotSortNumber(b.id)
  if (an != null && bn != null && an !== bn) return an - bn
  return a.id.localeCompare(b.id)
}

export function taskSnapshotItemFromJson(value: unknown, filename: string): TaskSnapshotItem | undefined {
  const raw = recordValue(value)
  if (!raw) return undefined
  const status = normalizeTaskStatus(raw.status)
  const text = trimmedString(raw.subject) || trimmedString(raw.content)
  if (!status || !text) return undefined
  const id = trimmedString(raw.id) || basename(filename, '.json')
  const activeText = trimmedString(raw.activeForm) || undefined
  const blockedBy = Array.isArray(raw.blockedBy)
    ? raw.blockedBy.filter((item): item is string => typeof item === 'string')
    : []
  return { id, text, activeText, status, blockedBy }
}
