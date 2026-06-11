#!/usr/bin/env bun
import { createConnection, type Socket } from 'net'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'

const args = process.argv.slice(2)
function option(name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
function required(name: string): string {
  const value = option(name)
  if (!value) throw new Error(`missing ${name}`)
  return value
}

const sock = option('--sock') ?? join(homedir(), '.config/claude-channel-mux/daemon.sock')
const sessionId = required('--session-id')
const parentChatId = required('--parent-chat-id')
const workerRoomId = required('--worker-room-id')
const cwd = required('--cwd')
const runtime = (option('--runtime') ?? 'codex') as 'claude' | 'codex'
const output = required('--output')
const limit = Number(option('--limit') ?? '80')
const taskFile = option('--task-file')
const taskText = taskFile ? readFileSync(taskFile, 'utf8') : required('--task')

if (!existsSync(sock)) throw new Error(`daemon socket does not exist: ${sock}`)
if (!cwd.startsWith('/')) throw new Error('--cwd must be absolute')
if (runtime !== 'claude' && runtime !== 'codex') throw new Error('--runtime must be claude or codex')

type Frame = Record<string, unknown>
const pending = new Map<string, { resolve: (value: string) => void; reject: (err: Error) => void }>()
let buffer = ''
let callCounter = 0

function sendFrame(conn: Socket, frame: Frame): void {
  conn.write(JSON.stringify(frame) + '\n')
}

function callTool(conn: Socket, tool: string, toolArgs: Record<string, unknown>): Promise<string> {
  const callId = `live-smoke-${Date.now()}-${++callCounter}`
  sendFrame(conn, { type: 'tool_call', tool, args: toolArgs, callId })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(callId)
      reject(new Error(`${tool} timed out`))
    }, 180_000)
    pending.set(callId, {
      resolve: value => { clearTimeout(timeout); resolve(value) },
      reject: err => { clearTimeout(timeout); reject(err) },
    })
  })
}

function parseResult(text: string): unknown {
  try { return JSON.parse(text) } catch { return text }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  const conn = createConnection(sock)
  await new Promise<void>((resolve, reject) => {
    conn.once('connect', resolve)
    conn.once('error', reject)
  })

  conn.on('data', chunk => {
    buffer += chunk.toString()
    let newline: number
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      let frame: Frame
      try { frame = JSON.parse(line) } catch { continue }
      if (frame.type === 'tool_result' && typeof frame.callId === 'string') {
        pending.get(frame.callId)?.resolve(typeof frame.result === 'string' ? frame.result : '')
        pending.delete(frame.callId)
      } else if (frame.type === 'tool_error' && typeof frame.callId === 'string') {
        pending.get(frame.callId)?.reject(new Error(typeof frame.error === 'string' ? frame.error : 'tool error'))
        pending.delete(frame.callId)
      }
    }
  })

  sendFrame(conn, { type: 'register', uuid: sessionId, pid: process.pid })
  await wait(1000)

  const results: Array<{ tool: string; result?: unknown; error?: string }> = []
  for (const [tool, toolArgs] of [
    ['bind_worker_room', { chat_id: parentChatId, room_id: workerRoomId, cwd, runtime }],
    ['start_worker_agent', { chat_id: parentChatId, room_id: workerRoomId, runtime }],
    ['send_worker_task', { chat_id: parentChatId, room_id: workerRoomId, runtime, text: taskText }],
  ] as Array<[string, Record<string, unknown>]>) {
    try {
      results.push({ tool, result: parseResult(await callTool(conn, tool, toolArgs)) })
    } catch (err) {
      results.push({ tool, error: err instanceof Error ? err.message : String(err) })
      break
    }
  }

  if (!results.some(result => result.tool === 'send_worker_task' && !result.error)) {
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, JSON.stringify({ ok: false, results }, null, 2) + '\n')
    conn.end()
    process.exitCode = 1
    return
  }

  await wait(45_000)
  try {
    results.push({ tool: 'capture_worker_report', result: parseResult(await callTool(conn, 'capture_worker_report', { chat_id: parentChatId, room_id: workerRoomId, runtime, limit })) })
  } catch (err) {
    results.push({ tool: 'capture_worker_report', error: err instanceof Error ? err.message : String(err) })
  }

  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify({ ok: results.every(result => !result.error), parentChatId, workerRoomId, cwd, runtime, capturedAt: new Date().toISOString(), results }, null, 2) + '\n')
  conn.end()
  if (results.some(result => result.error)) process.exitCode = 1
}

main().catch(err => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err))
  process.exit(1)
})
