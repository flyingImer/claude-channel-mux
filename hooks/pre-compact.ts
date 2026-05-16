#!/usr/bin/env bun
/**
 * PreCompact hook — fires when CC is about to compact the conversation.
 * Pings the daemon so the channel user sees 🗜️ BEFORE compaction (not after,
 * which is what the post-hoc JSONL poll gives them).
 *
 * Wired in by daemon.ts via the per-session settings-{uuid}.json file.
 * CC passes session_id on stdin as JSON.
 */
import { createConnection } from 'net'
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { fileURLToPath } from 'url'

const SOCK = join(homedir(), '.config', 'claude-channel-mux', 'daemon.sock')

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function preCompactSessionId(input: string): string | undefined {
  let parsed: unknown
  try { parsed = JSON.parse(input) } catch { return undefined }
  const record = recordValue(parsed)
  const sessionId = record?.session_id
  return typeof sessionId === 'string' && sessionId.trim() ? sessionId : undefined
}

export function compactStartingMessage(uuid: string): string {
  return JSON.stringify({ type: 'compact_starting', uuid }) + '\n'
}

export function notifyCompactStarting(uuid: string, sockPath = SOCK): void {
  const sock = createConnection(sockPath)
  sock.on('connect', () => {
    sock.write(compactStartingMessage(uuid))
    sock.end()
  })
  sock.on('error', () => process.exit(0))
  setTimeout(() => process.exit(0), 2000)
}

export function main(): void {
  let input: string
  try { input = readFileSync(0, 'utf8') } catch { process.exit(0) }

  const uuid = preCompactSessionId(input)
  if (!uuid) process.exit(0)
  notifyCompactStarting(uuid)
}

const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false
if (invokedPath) main()
