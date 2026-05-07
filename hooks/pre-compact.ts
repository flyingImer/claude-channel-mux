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

const SOCK = join(homedir(), '.config', 'claude-channel-mux', 'daemon.sock')

let input: string
try { input = readFileSync(0, 'utf8') } catch { process.exit(0) }

let data: { session_id?: string }
try { data = JSON.parse(input) } catch { process.exit(0) }

const uuid = data.session_id
if (!uuid) process.exit(0)

const sock = createConnection(SOCK)
sock.on('connect', () => {
  sock.write(JSON.stringify({ type: 'compact_starting', uuid }) + '\n')
  sock.end()
})
sock.on('error', () => process.exit(0))
setTimeout(() => process.exit(0), 2000)
