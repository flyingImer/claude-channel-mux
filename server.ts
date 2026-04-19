#!/usr/bin/env bun
/// <reference types="bun-types" />
/**
 * CC Channel Bridge — per-session MCP server.
 *
 * Thin bridge between a CC session and the daemon. Does not connect to
 * Slack/Telegram directly. All I/O goes through the daemon via IPC.
 *
 * Env vars (set by daemon when spawning):
 *   CC_CHANNEL_SESSION_UUID  — daemon's session ID
 *   CC_CHANNEL_DAEMON_SOCK — path to daemon's unix socket
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createConnection, type Socket } from 'net'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SESSION_UUID = process.env.CC_CHANNEL_SESSION_UUID
const DAEMON_SOCK = process.env.CC_CHANNEL_DAEMON_SOCK
  ?? join(homedir(), '.config', 'claude-channel-mux', 'daemon.sock')

if (!SESSION_UUID) {
  // Not spawned by daemon — run as empty MCP server (CC auto-loaded the plugin).
  // Must exit when parent CC dies; otherwise bun tight-loops on the closed
  // stdio socket and orphans accumulate as CPU-burning zombies.
  process.stderr.write('claude-channel-mux: no CC_CHANNEL_SESSION_UUID, idling\n')
  const exit = () => process.exit(0)
  process.stdin.on('close', exit)
  process.stdin.on('end', exit)
  process.on('SIGTERM', exit)
  process.on('SIGHUP', exit)
  const idle = new Server(
    { name: 'claude-channel-mux', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  await idle.connect(new StdioServerTransport())
  await new Promise(() => {})
}

process.stderr.write(`claude-channel-mux: session=${SESSION_UUID} sock=${DAEMON_SOCK}\n`)

process.on('unhandledRejection', err => {
  process.stderr.write(`claude-channel-mux: unhandled rejection: ${err}\n`)
})

// ---------------------------------------------------------------------------
// IPC connection to daemon
// ---------------------------------------------------------------------------

const pendingCalls = new Map<string, {
  resolve: (result: string) => void
  reject: (err: Error) => void
}>()

let ipcBuffer = ''
let daemonConn: Socket | null = null
let registeredChannels: string[] = []
let connected = false

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000] // backoff
let reconnectAttempt = 0

function connectToDaemon(): Promise<void> {
  return new Promise((resolve, reject) => {
    const firstConnect = !connected

    const conn = createConnection(DAEMON_SOCK!, () => {
      process.stderr.write('claude-channel-mux: connected to daemon\n')
      daemonConn = conn
      connected = true
      reconnectAttempt = 0
      ipcBuffer = ''
      // Send our pid so the daemon can enforce "one primary per UUID" and
      // reject subagent duplicates (subagents inherit CC_CHANNEL_SESSION_UUID
      // from the main CC's env, but should not own the channel).
      conn.write(JSON.stringify({ type: 'register', uuid: SESSION_UUID, pid: process.pid }) + '\n')
      resolve()
    })

    conn.on('data', (chunk: Buffer) => {
      ipcBuffer += chunk.toString()
      let nl: number
      while ((nl = ipcBuffer.indexOf('\n')) !== -1) {
        const line = ipcBuffer.slice(0, nl).trim()
        ipcBuffer = ipcBuffer.slice(nl + 1)
        if (line) handleDaemonMessage(line)
      }
    })

    conn.on('error', err => {
      process.stderr.write(`claude-channel-mux: daemon error: ${err}\n`)
      if (firstConnect && !connected) reject(err)
    })

    conn.on('close', () => {
      daemonConn = null
      connected = false
      process.stderr.write('claude-channel-mux: daemon disconnected\n')
      for (const [, p] of pendingCalls) p.reject(new Error('daemon disconnected'))
      pendingCalls.clear()
      // Auto-reconnect
      if (!shuttingDown) scheduleReconnect()
    })
  })
}

function scheduleReconnect(): void {
  const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)]
  reconnectAttempt++
  process.stderr.write(`claude-channel-mux: reconnecting in ${delay}ms (attempt ${reconnectAttempt})\n`)
  setTimeout(async () => {
    if (shuttingDown) return
    try {
      await connectToDaemon()
    } catch {
      // connectToDaemon's close handler will schedule next retry
    }
  }, delay)
}

function handleDaemonMessage(data: string): void {
  let msg: Record<string, unknown>
  try { msg = JSON.parse(data) } catch { return }

  switch (msg.type) {
    case 'registered': {
      registeredChannels = (msg.channels as string[]) ?? []
      process.stderr.write(`claude-channel-mux: registered, channels: ${registeredChannels.join(', ')}\n`)
      break
    }

    case 'duplicate': {
      // Daemon rejected this register: the primary server.ts for this UUID is
      // already connected. We're a secondary — almost always a CC subagent
      // that inherited CC_CHANNEL_SESSION_UUID from the parent's env. Subagents
      // should not own the channel (product decision: one session = one voice),
      // so detach from the daemon and go idle. Stay as an empty MCP server
      // for the subagent's own use — reply/react/etc. will just return errors
      // from the local pending-call map when not connected, which is fine.
      process.stderr.write(`claude-channel-mux: secondary session rejected by daemon (${msg.reason ?? 'duplicate'}), going idle\n`)
      shuttingDown = true  // stop reconnect backoff
      try { daemonConn?.end() } catch {}
      daemonConn = null
      connected = false
      break
    }

    case 'permission_response': {
      // Daemon relayed user's Allow/Deny button click
      void mcp.notification({
        method: 'notifications/claude/channel/permission',
        params: {
          request_id: msg.request_id as string,
          behavior: msg.behavior as 'allow' | 'deny',
        },
      })
      break
    }

    case 'inbound': {
      void mcp.notification({
        method: 'notifications/claude/channel',
        params: {
          content: msg.content as string,
          meta: msg.meta as Record<string, string>,
        },
      })
      break
    }

    case 'tool_result': {
      const p = pendingCalls.get(msg.callId as string)
      if (p) {
        pendingCalls.delete(msg.callId as string)
        p.resolve(msg.result as string)
      }
      break
    }

    case 'tool_error': {
      const p = pendingCalls.get(msg.callId as string)
      if (p) {
        pendingCalls.delete(msg.callId as string)
        p.reject(new Error(msg.error as string))
      }
      break
    }

    case 'pong':
      break
  }
}

function callDaemonTool(tool: string, args: Record<string, unknown>): Promise<string> {
  if (!daemonConn) return Promise.reject(new Error('not connected to daemon'))
  const callId = randomBytes(8).toString('hex')
  const conn = daemonConn  // capture ref
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingCalls.delete(callId)
      reject(new Error('tool call timed out (60s)'))
    }, 60000)

    pendingCalls.set(callId, {
      resolve: r => { clearTimeout(timeout); resolve(r) },
      reject: e => { clearTimeout(timeout); reject(e) },
    })

    try {
      conn.write(JSON.stringify({ type: 'tool_call', tool, args, callId }) + '\n')
    } catch (err) {
      clearTimeout(timeout)
      pendingCalls.delete(callId)
      reject(err)
    }
  })
}

// Wait for daemon, then connect
let retries = 0
while (!existsSync(DAEMON_SOCK!) && retries < 30) {
  await new Promise(r => setTimeout(r, 1000))
  retries++
}
await connectToDaemon()

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const mcp = new Server(
  { name: 'claude-channel-mux', version: '1.0.0' },
  {
    capabilities: {
      tools: {},
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {},
      },
    },
    instructions: [
      'Messages arrive from Slack or Telegram as <channel source="claude-channel-mux" chat_id="slack:C123" ...> or <channel source="claude-channel-mux" chat_id="telegram:456" ...>.',
      '',
      'The chat_id prefix tells you the platform. Reply with the reply tool, passing chat_id back exactly.',
      '',
      'reply accepts file paths (files: ["/abs/path"]) for attachments. Images are shown inline, other files as downloads.',
      'Edits do not trigger push notifications — send a new reply when a long task completes.',
      '',
      'When a message has attachment_file_id in its meta, the user sent a file or image.',
      'Call download_attachment with that file_id to save it locally, then Read the file.',
      'For images: Read the downloaded path — you are multimodal and can see images directly.',
      'For documents: Read the file to understand its contents.',
      'Always acknowledge file receipt (react 👀) before downloading.',
      '',
      'Use react to add emoji reactions to messages. Reactions are lightweight acknowledgments — prefer them over text replies when appropriate:',
      '- User asks you to do something → react 👀 (seen) immediately, then do the work, then reply with results',
      '- User shares something → react with an appropriate emoji (👍 🎉 🔥 ❤️ etc.) instead of a generic "thanks" text reply',
      '- Task completed → react ✅ on the original request message',
      '- Working on something that takes time → react ⏳ on the message so user knows you are on it, then react ✅ when done',
      '- Not every message needs a text reply. A reaction can be the complete response.',
      '',
      'Threading — how to use the reply_to arg:',
      '- When you call reply, set reply_to from the meta of the SPECIFIC inbound message you are answering right now, not a previous one.',
      '- If that inbound has reply_to_id in its meta, pass reply_to=<that reply_to_id>. The reply lands in the same thread the user was typing in.',
      '- If that inbound has NO reply_to_id, pass reply_to=<that inbound is message_id>. This starts a new thread anchored under the user\'s message so the conversation stays tied together.',
      '- Never reuse a reply_to value from a prior turn — different user messages belong to different threads.',
      '- If the user has multiple open threads, reply_to must match the thread of the message you are currently answering.',
      'If that message is in your context, you already have the context. If it was compacted, use fetch_thread to pull the full thread history (Slack only).',
      'When replying in a thread (reply_to set), the message appears in both the thread and the main channel.',
      '',
      'You can reply to any of your bound channels. Messages from the user indicate which channel they came from.',
    ].join('\n'),
  },
)

// Permission request relay — send to daemon as structured event, not text
mcp.setNotificationHandler(
  z.object({
    method: z.literal('notifications/claude/channel/permission_request'),
    params: z.object({
      request_id: z.string(),
      tool_name: z.string(),
      description: z.string(),
      input_preview: z.string(),
    }),
  }),
  async ({ params }) => {
    if (!daemonConn) return
    // Send to daemon as a permission_request event — daemon renders as inline keyboard
    daemonConn.write(JSON.stringify({
      type: 'permission_request',
      ...params,
      channels: registeredChannels,
    }) + '\n')
  },
)

// Tools
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Reply to a Slack/Telegram channel. Pass chat_id from the inbound message.',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: { type: 'string', description: 'Channel key (e.g. slack:C123 or telegram:456)' },
          text: { type: 'string' },
          reply_to: { type: 'string', description: 'Message ID to thread under (optional)' },
          files: { type: 'array', items: { type: 'string' }, description: 'File paths to attach' },
        },
        required: ['chat_id', 'text'],
      },
    },
    {
      name: 'react',
      description: 'Add an emoji reaction.',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: { type: 'string' },
          message_id: { type: 'string' },
          emoji: { type: 'string' },
        },
        required: ['chat_id', 'message_id', 'emoji'],
      },
    },
    {
      name: 'edit_message',
      description: 'Edit a previously sent message.',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: { type: 'string' },
          message_id: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['chat_id', 'message_id', 'text'],
      },
    },
    {
      name: 'download_attachment',
      description: 'Download a file attachment to local inbox.',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: { type: 'string', description: 'Channel key (needed to determine platform)' },
          file_id: { type: 'string' },
        },
        required: ['chat_id', 'file_id'],
      },
    },
    {
      name: 'fetch_thread',
      description: 'Fetch full thread/conversation history. Use when you need context from earlier messages that may have been compacted. Slack: returns full thread. Telegram: not supported.',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: { type: 'string', description: 'Channel key' },
          thread_id: { type: 'string', description: 'Thread ID (Slack: thread_ts from reply_to_id)' },
        },
        required: ['chat_id', 'thread_id'],
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>
  try {
    const result = await callDaemonTool(req.params.name, args)
    return { content: [{ type: 'text', text: result }] }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { content: [{ type: 'text', text: `${req.params.name} failed: ${msg}` }], isError: true }
  }
})

await mcp.connect(new StdioServerTransport())

// Keepalive
setInterval(() => {
  if (daemonConn) try { daemonConn.write('{"type":"ping"}\n') } catch {}
}, 15000).unref()

// Shutdown
let shuttingDown = false
function shutdown(): void {
  if (shuttingDown) return
  shuttingDown = true
  try { daemonConn?.end() } catch {}
  setTimeout(() => process.exit(0), 2000).unref()
}
process.stdin.on('end', shutdown)
process.stdin.on('close', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
