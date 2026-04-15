#!/usr/bin/env bun
/// <reference types="bun-types" />
/**
 * claude-channel-mux daemon — session orchestrator.
 *
 * Platform-agnostic core. Messaging platforms are pluggable adapters
 * (adapters/*.ts) that implement the ChannelAdapter interface.
 *
 * Responsibilities:
 *   - Load and start all configured adapters
 *   - Parse magic words (ccm, ccm resume, ccm stop)
 *   - Spawn CC sessions in zellij panes with pre-assigned UUIDs
 *   - Route messages between channels and sessions via IPC
 *   - Persist bindings: { channel_key → CC UUID }
 *
 * Magic words:
 *   ccm                 → new session (default cwd) + bind
 *   ccm /path/to/dir    → new session (specified cwd) + bind
 *   ccm resume          → interactive session picker
 *   ccm resume <uuid>   → resume + bind
 *   ccm stop            → unbind (suspend if last channel)
 */

import {
  readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync,
  readdirSync, statSync, chmodSync,
} from 'fs'
import { homedir } from 'os'
import { join, basename } from 'path'
import { createServer, type Server as NetServer, type Socket } from 'net'
import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import type { ChannelAdapter, InboundMessage } from './adapters/types.js'
import { SlackAdapter } from './adapters/slack.js'
import { TelegramAdapter } from './adapters/telegram.js'
import { closeTab, findPaneByTabName, sendKeys, dumpScreen, dumpScreenAsync } from './escort.js'
import { watch as fsWatch, readFileSync as fsReadSync } from 'fs'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const STATE_DIR = process.env.CHANNEL_DAEMON_STATE_DIR
  ?? join(homedir(), '.config', 'claude-channel-mux')
const ENV_FILE = join(STATE_DIR, '.env')
const SOCK_PATH = join(STATE_DIR, 'daemon.sock')
const PID_FILE = join(STATE_DIR, 'daemon.pid')
const INBOX_DIR = join(STATE_DIR, 'inbox')
const BINDINGS_FILE = join(STATE_DIR, 'bindings.json')
const DEFAULT_CWD = process.env.CHANNEL_DAEMON_CWD ?? homedir()
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude'
// Page size now comes from adapter.pageSize
const CC_PROJECTS_DIR = join(homedir(), '.claude', 'projects')

mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
mkdirSync(INBOX_DIR, { recursive: true, mode: 0o700 })

// Load .env
try {
  const raw = readFileSync(ENV_FILE, 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq)
    const val = trimmed.slice(eq + 1)
    if (!process.env[key]) process.env[key] = val
  }
} catch {}

process.on('unhandledRejection', err =>
  process.stderr.write(`daemon: unhandled rejection: ${err}\n`))
process.on('uncaughtException', err =>
  process.stderr.write(`daemon: uncaught exception: ${err}\n`))

// ---------------------------------------------------------------------------
// Adapters — register all known platforms, start configured ones
// ---------------------------------------------------------------------------

const adapters: ChannelAdapter[] = [
  new SlackAdapter({
    botToken: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    inboxDir: INBOX_DIR,
  }),
  new TelegramAdapter({
    token: process.env.TELEGRAM_BOT_TOKEN,
    inboxDir: INBOX_DIR,
  }),
]

const activeAdapters = adapters.filter(a => a.configured)

if (activeAdapters.length === 0) {
  process.stderr.write(
    `daemon: No channels configured. Set tokens in ${ENV_FILE}:\n` +
    `  SLACK_BOT_TOKEN + SLACK_APP_TOKEN  (Slack)\n` +
    `  TELEGRAM_BOT_TOKEN  (Telegram)\n`,
  )
  process.exit(1)
}

/** Find the adapter for a channel key */
function adapterFor(channelKey: string): ChannelAdapter | undefined {
  const platform = channelKey.slice(0, channelKey.indexOf(':'))
  return activeAdapters.find(a => a.platform === platform)
}

/** Extract platform-local ID from channel key */
function localId(channelKey: string): string {
  return channelKey.slice(channelKey.indexOf(':') + 1)
}

// ---------------------------------------------------------------------------
// Bindings — { channel_key → CC UUID }
// ---------------------------------------------------------------------------

type Bindings = Record<string, string>

function loadBindings(): Bindings {
  try { return JSON.parse(readFileSync(BINDINGS_FILE, 'utf8')) } catch { return {} }
}

function saveBindings(b: Bindings): void {
  const tmp = BINDINGS_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(b, null, 2) + '\n', { mode: 0o600 })
  require('fs').renameSync(tmp, BINDINGS_FILE)
}

// ---------------------------------------------------------------------------
// CC transcript metadata
// ---------------------------------------------------------------------------

/**
 * Reverse CC's sanitizePath: given a sanitized dir name like "-home-yijwang-ws-cc-study",
 * find the actual directory path by checking what exists on disk.
 * CC's sanitizePath replaces ALL non-alphanumeric chars with '-', so it's lossy.
 * We try the original cwd first (from the session's working directory).
 */
/**
 * Reverse CC's sanitizePath. Since it replaces ALL non-alphanumeric with '-',
 * it's lossy. We reconstruct by walking the filesystem: starting from /,
 * greedily match directory names against the sanitized segments.
 */
function unsanitizePath(sanitized: string): string {
  const { existsSync, readdirSync } = require('fs') as typeof import('fs')

  // Remove leading - (was /)
  const segments = sanitized.replace(/^-/, '').split('-').filter(Boolean)
  if (segments.length === 0) return '/'

  // Greedy walk: at each level, find the dir whose sanitized name matches
  // the next N segments consumed together
  let current = '/'
  let i = 0
  while (i < segments.length) {
    let found = false
    try {
      const entries = readdirSync(current).filter(e => {
        try { return statSync(join(current, e)).isDirectory() } catch { return false }
      })
      // Try matching longest segment run first (greedy)
      for (let len = segments.length - i; len >= 1; len--) {
        const candidate = segments.slice(i, i + len).join('-')
        if (entries.includes(candidate)) {
          current = join(current, candidate)
          i += len
          found = true
          break
        }
      }
    } catch {}
    if (!found) {
      // Can't resolve further — append remaining as-is
      current = join(current, segments.slice(i).join('-'))
      break
    }
  }
  return current
}

function findTranscript(uuid: string): { mtime: number; size: number; projectDir: string } | null {
  try {
    for (const proj of readdirSync(CC_PROJECTS_DIR)) {
      const p = join(CC_PROJECTS_DIR, proj, `${uuid}.jsonl`)
      try {
        const st = statSync(p)
        return { mtime: st.mtimeMs, size: st.size, projectDir: proj }
      } catch {}
    }
  } catch {}
  return null
}

type SessionInfo = { uuid: string; mtime: number; size: number; cwd?: string; title?: string }

/** Extract session title (slug) from transcript JSONL — reads first few lines only */
/**
 * Extract session title from transcript. Priority:
 *   1. customTitle (user-set via /rename)
 *   2. aiTitle (AI-generated summary)
 *   3. First meaningful user prompt (same logic as CC's /resume)
 * Reads from tail of file first (titles are appended), then head for first prompt.
 */
function getSessionTitle(transcriptPath: string): string | undefined {
  try {
    const { readFileSync } = require('fs') as typeof import('fs')
    const content = readFileSync(transcriptPath, 'utf8')

    // Check tail (last 10KB) for customTitle or aiTitle — these are written late
    const tail = content.slice(-10000)
    let customTitle: string | undefined
    let aiTitle: string | undefined
    for (const line of tail.split('\n').reverse()) {
      if (!line) continue
      // Fast string match before JSON parse
      if (line.includes('customTitle') && !customTitle) {
        try {
          const obj = JSON.parse(line)
          if (obj.customTitle) customTitle = obj.customTitle
        } catch {}
      }
      if (line.includes('aiTitle') && !aiTitle) {
        try {
          const obj = JSON.parse(line)
          if (obj.aiTitle) aiTitle = obj.aiTitle
        } catch {}
      }
      if (customTitle) break  // best title found
    }
    if (customTitle) return customTitle
    if (aiTitle) return aiTitle.length > 60 ? aiTitle.slice(0, 57) + '…' : aiTitle

    // Fallback: first meaningful user message from head (first 20KB)
    const head = content.slice(0, 20000)
    for (const line of head.split('\n')) {
      if (!line.includes('"type":"user"') && !line.includes('"type": "user"')) continue
      if (line.includes('"isMeta":true') || line.includes('"isMeta": true')) continue
      if (line.includes('"isCompactSummary":true')) continue
      if (line.includes('"tool_result"')) continue
      try {
        const obj = JSON.parse(line)
        if (obj.type !== 'user' || obj.isMeta) continue
        const c = typeof obj.message?.content === 'string' ? obj.message.content : ''
        // Skip XML-wrapped commands and meta
        if (c.startsWith('<')) {
          // Extract command with args, but skip built-in CC commands
          const SKIP_CMDS = new Set(['effort', 'model', 'compact', 'clear', 'exit', 'help',
            'plugin', 'resume', 'status', 'cost', 'config', 'login', 'logout', 'vim',
            'theme', 'color', 'fast', 'permissions', 'hooks', 'mcp', 'memory', 'doctor'])
          const nameMatch = c.match(/<command-name>\/?(\S+)<\/command-name>/s)
          if (nameMatch && SKIP_CMDS.has(nameMatch[1])) continue
          const argsMatch = c.match(/<command-args>(.*?)<\/command-args>/s)
          if (nameMatch && argsMatch?.[1]?.trim()) {
            return `/${nameMatch[1]} ${argsMatch[1].trim()}`.slice(0, 60)
          }
          continue
        }
        const clean = c.replace(/\s+/g, ' ').trim()
        if (clean.length > 5) return clean.slice(0, 60)
      } catch {}
    }
  } catch {}
  return undefined
}

function listSessions(): SessionInfo[] {
  const uuids = [...new Set(Object.values(loadBindings()))]
  return uuids
    .map(uuid => {
      const t = findTranscript(uuid)
      return {
        uuid,
        mtime: t?.mtime ?? 0,
        size: t?.size ?? 0,
        cwd: t ? unsanitizePath(t.projectDir).replace(/^\//, '') : undefined,
      }
    })
    .sort((a, b) => b.mtime - a.mtime)
}

/** List ALL CC sessions from disk (not just ccm-managed). For connecting to existing sessions. */
function listAllCCSessions(limit = 20): SessionInfo[] {
  const sessions: SessionInfo[] = []
  const seen = new Set<string>()
  try {
    for (const proj of readdirSync(CC_PROJECTS_DIR)) {
      const projDir = join(CC_PROJECTS_DIR, proj)
      try {
        for (const file of readdirSync(projDir)) {
          if (!file.endsWith('.jsonl')) continue
          const uuid = file.replace('.jsonl', '')
          // Validate UUID format (skip agent transcripts etc)
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) continue
          if (seen.has(uuid)) continue
          seen.add(uuid)
          try {
            const st = statSync(join(projDir, file))
            sessions.push({
              uuid,
              mtime: st.mtimeMs,
              size: st.size,
              cwd: unsanitizePath(proj),
              title: getSessionTitle(join(projDir, file)),
            })
          } catch {}
        }
      } catch {}
    }
  } catch {}
  return sessions.sort((a, b) => b.mtime - a.mtime).slice(0, limit)
}

function channelsForUuid(uuid: string): string[] {
  const b = loadBindings()
  return Object.entries(b).filter(([, v]) => v === uuid).map(([k]) => k)
}

// ---------------------------------------------------------------------------
// Startup: clean stale bindings
// ---------------------------------------------------------------------------

function cleanStaleBindings(): void {
  const b = loadBindings()
  let cleaned = 0
  for (const uuid of [...new Set(Object.values(b))]) {
    if (!findTranscript(uuid)) {
      for (const [ck, v] of Object.entries(b)) {
        if (v === uuid) { delete b[ck]; cleaned++ }
      }
    }
  }
  if (cleaned > 0) {
    saveBindings(b)
    process.stderr.write(`daemon: cleaned ${cleaned} stale binding(s)\n`)
  }
}

cleanStaleBindings()

// ---------------------------------------------------------------------------
// Live sessions
// ---------------------------------------------------------------------------

type Live = { ipcConn: Socket | null; child: ChildProcess | null }
const live = new Map<string, Live>()
const socketToUuid = new Map<Socket, string>()
// Track last inbound message per channel for ack reaction cleanup
const lastInboundMsg = new Map<string, string>()  // channel_key → message_id

function sendToLive(uuid: string, msg: Record<string, unknown>): void {
  const l = live.get(uuid)
  if (!l?.ipcConn) return
  try { l.ipcConn.write(JSON.stringify(msg) + '\n') } catch {}
}

// ---------------------------------------------------------------------------
// Zellij detection
// ---------------------------------------------------------------------------

const ZELLIJ_SESSION = 'ccmux'

function hasZellij(): boolean {
  try {
    const { execSync } = require('child_process') as typeof import('child_process')
    execSync('which zellij', { encoding: 'utf8', stdio: 'pipe' })
    return true
  } catch {
    process.stderr.write('daemon: zellij not found, sessions will run as background processes\n')
    return false
  }
}

/** Ensure ccmux zellij session exists. Creates it with a keeper tab if needed. */
async function ensureZellijSession(): Promise<void> {
  const { exec: execCb, spawn: spawnChild } = require('child_process') as typeof import('child_process')
  const { promisify } = require('util') as typeof import('util')
  const exec = promisify(execCb)
  try {
    const { stdout: out } = await exec('zellij list-sessions 2>&1', { encoding: 'utf8' })
    // Check each line for our session — other sessions may show EXITED
    const lines = out.split('\n')
    const ourLine = lines.find(l => l.includes(ZELLIJ_SESSION))
    if (ourLine && !ourLine.includes('EXITED')) return
    // Delete exited session
    if (ourLine) {
      try { await exec(`zellij delete-session ${ZELLIJ_SESSION} --force 2>/dev/null`, { encoding: 'utf8' }) } catch {}
    }
  } catch {}
  // Create session: use script to fake a TTY so zellij can start detached.
  // Kill the script process after session is up so no phantom client remains
  // (phantom client locks window size to 80x24, preventing resize on attach).
  try {
    const scriptProc = spawnChild('bash', ['-c', `script -qfc "zellij -s ${ZELLIJ_SESSION}" /dev/null`], {
      stdio: 'ignore', detached: true,
    })
    scriptProc.unref()
    // Wait for registration
    for (let i = 0; i < 20; i++) {
      try {
        const { stdout: check } = await exec('zellij list-sessions 2>&1', { encoding: 'utf8' })
        const checkLines = check.split('\n')
        const checkLine = checkLines.find(l => l.includes(ZELLIJ_SESSION))
        if (checkLine && !checkLine.includes('EXITED')) {
          // Kill the script process — its fake TTY client is no longer needed
          try { scriptProc.kill() } catch {}
          process.stderr.write(`daemon: created zellij session "${ZELLIJ_SESSION}"\n`)
          return
        }
      } catch {}
      await new Promise(r => setTimeout(r, 300))
    }
    try { scriptProc.kill() } catch {}
  } catch {}
  process.stderr.write(`daemon: warning: could not create zellij session\n`)
}

const zellijAvailable = hasZellij()

/** Clean up exited ccm tabs in zellij. Run on startup and after session exit. */
function cleanExitedTabs(): void {
  if (!zellijAvailable) return
  try {
    const { execSync: ex } = require('child_process') as typeof import('child_process')
    const panes = JSON.parse(ex(`zellij --session ${ZELLIJ_SESSION} action list-panes --json --tab --state 2>/dev/null`, { encoding: 'utf8' }))
    for (const p of panes) {
      if (p.tab_name?.startsWith('ccm:') && p.exited) {
        try {
          ex(`zellij --session ${ZELLIJ_SESSION} action close-tab-by-id ${p.tab_id}`, { encoding: 'utf8' })
          process.stderr.write(`daemon: cleaned exited tab ${p.tab_name}\n`)
        } catch {}
      }
    }
  } catch {}
}

cleanExitedTabs()

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

// Plugin directory for --plugin-dir. When installed via marketplace, CC finds
// the plugin automatically and this is unnecessary. For dev/testing, set
// CLAUDE_CHANNEL_MUX_PLUGIN_DIR to the plugin directory.
const PLUGIN_DIR = process.env.CLAUDE_CHANNEL_MUX_PLUGIN_DIR ?? ''

// Spawn mode: 'same-dir' (default) or 'worktree' (git worktree isolation per session)
const SPAWN_MODE = (process.env.CHANNEL_DAEMON_SPAWN_MODE ?? 'same-dir') as 'same-dir' | 'worktree'

/**
 * Create a git worktree for a session. Returns the worktree path,
 * or null if not in a git repo or worktree creation fails.
 */
function createWorktree(baseCwd: string, uuid: string): string | null {
  try {
    const { execSync: ex } = require('child_process') as typeof import('child_process')
    // Check if cwd is a git repo
    ex('git rev-parse --git-dir', { cwd: baseCwd, encoding: 'utf8', stdio: 'pipe' })
    const branch = `ccm/${uuid.slice(0, 8)}`
    const worktreePath = join(baseCwd, '.claude', 'worktrees', uuid.slice(0, 8))
    mkdirSync(join(baseCwd, '.claude', 'worktrees'), { recursive: true })
    ex(`git worktree add -b "${branch}" "${worktreePath}" HEAD`, {
      cwd: baseCwd, encoding: 'utf8', stdio: 'pipe',
    })
    process.stderr.write(`daemon: created worktree ${worktreePath} (branch ${branch})\n`)
    return worktreePath
  } catch (err) {
    process.stderr.write(`daemon: worktree creation failed: ${err}\n`)
    return null
  }
}

/**
 * Remove a git worktree after session ends.
 */
function removeWorktree(baseCwd: string, uuid: string): void {
  try {
    const { execSync: ex } = require('child_process') as typeof import('child_process')
    const worktreePath = join(baseCwd, '.claude', 'worktrees', uuid.slice(0, 8))
    ex(`git worktree remove "${worktreePath}" --force`, {
      cwd: baseCwd, encoding: 'utf8', stdio: 'pipe',
    })
    // Clean up the branch
    const branch = `ccm/${uuid.slice(0, 8)}`
    ex(`git branch -D "${branch}"`, { cwd: baseCwd, encoding: 'utf8', stdio: 'pipe' })
    process.stderr.write(`daemon: removed worktree ${worktreePath}\n`)
  } catch {}
}

async function spawnCC(uuid: string, cwd: string, resumeMode: boolean): Promise<boolean> {
  // Worktree isolation: create a git worktree for new sessions
  let effectiveCwd = cwd
  if (SPAWN_MODE === 'worktree' && !resumeMode) {
    const wt = createWorktree(cwd, uuid)
    if (wt) effectiveCwd = wt
  }

  const pluginArgs = PLUGIN_DIR ? ['--plugin-dir', PLUGIN_DIR] : []
  // plugin:name@inline for --plugin-dir loaded plugins; plugin:name@marketplace for installed
  const channelTag = PLUGIN_DIR ? 'plugin:claude-channel-mux@inline' : 'plugin:claude-channel-mux@claude-plugins-official'
  const channelArgs = ['--dangerously-load-development-channels', channelTag]
  const modeArgs = ['--dangerously-skip-permissions']
  // Disable other channel plugins to prevent tool name collisions (#38098)
  // Write to temp file because JSON in shell args gets mangled by bash -c quoting
  const settingsFile = join(STATE_DIR, `settings-${uuid.slice(0, 8)}.json`)
  writeFileSync(settingsFile, JSON.stringify({
    enabledPlugins: {
      'telegram@claude-plugins-official': false,
      'discord@claude-plugins-official': false,
      'imessage@claude-plugins-official': false,
      'slack@claude-plugins-official': false,
    },
  }))
  const settingsArgs = ['--settings', settingsFile]
  // Allow all ccm MCP tools without permission prompts
  // Tool name format: mcp__plugin_<plugin>_<server>__<tool>
  const toolPrefix = 'mcp__plugin_claude-channel-mux_claude-channel-mux'
  const allowedToolsArgs = ['--allowedTools',
    `${toolPrefix}__reply`,
    `${toolPrefix}__react`,
    `${toolPrefix}__edit_message`,
    `${toolPrefix}__download_attachment`,
    `${toolPrefix}__fetch_thread`,
  ]
  const args = resumeMode
    ? ['--resume', uuid, ...pluginArgs, ...channelArgs, ...modeArgs, ...settingsArgs, ...allowedToolsArgs]
    : ['--session-id', uuid, ...pluginArgs, ...channelArgs, ...modeArgs, ...settingsArgs, ...allowedToolsArgs]

  const env = {
    ...process.env,
    CC_CHANNEL_SESSION_UUID: uuid,
    CC_CHANNEL_DAEMON_SOCK: SOCK_PATH,
    CLAUBBIT: '1',                // skip workspace trust dialog
    DISABLE_AUTOUPDATER: '1',     // skip auto-update check
  }
  const tabName = `ccm:${uuid.slice(0, 8)}`

  if (zellijAvailable) {
    try {
      // Ensure ccmux session exists (may have been killed/exited)
      await ensureZellijSession()

      // Don't create duplicate tabs — reuse existing if alive
      const existingPane = findPaneByTabName(tabName)
      if (existingPane && !existingPane.exited) {
        process.stderr.write(`daemon: tab "${tabName}" already exists (pane ${existingPane.paneId}), reusing\n`)
        live.set(uuid, { ipcConn: null, child: null })
        return true
      }

      const { exec: execCb } = require('child_process') as typeof import('child_process')
      const { promisify } = require('util') as typeof import('util')
      const exec = promisify(execCb)
      const cmd = [CLAUDE_BIN, ...args].map(a => `"${a}"`).join(' ')
      const envExports = `export CC_CHANNEL_SESSION_UUID="${uuid}" CC_CHANNEL_DAEMON_SOCK="${SOCK_PATH}" CLAUBBIT=1 DISABLE_AUTOUPDATER=1;`
      await exec(
        `zellij --session ${ZELLIJ_SESSION} action new-tab --name "${tabName}" -- bash -c '${envExports} cd "${effectiveCwd}" && exec ${cmd}'`,
        { encoding: 'utf8', timeout: 10000 },
      )
      process.stderr.write(`daemon: spawned ${uuid.slice(0, 8)} in zellij tab "${tabName}"\n`)

      // Dev channels dialog will be shown to user via screen watcher buttons
    } catch (err) {
      process.stderr.write(`daemon: zellij spawn failed: ${err}\n`)
      // Fallback to direct
      return spawnDirect(uuid, args, cwd, env)
    }
  } else {
    return spawnDirect(uuid, args, cwd, env)
  }

  // For zellij mode: no ChildProcess to track. Session is tracked via IPC.
  // When server.ts connects → live entry gets ipcConn.
  // When server.ts disconnects → ipcConn = null (session ended or CC exited).
  live.set(uuid, { ipcConn: null, child: null })
  return true
}


function spawnDirect(uuid: string, args: string[], cwd: string, env: Record<string, string | undefined>): boolean {
  try {
    const child = spawn(CLAUDE_BIN, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true, env })
    child.stderr?.on('data', (c: Buffer) => process.stderr.write(`[${uuid.slice(0, 8)}] ${c}`))
    child.unref()

    child.on('exit', (code) => {
      live.delete(uuid)
      socketToUuid.forEach((u, s) => { if (u === uuid) socketToUuid.delete(s) })
      process.stderr.write(`daemon: session ${uuid.slice(0, 8)} exited (code ${code})\n`)
    })

    live.set(uuid, { ipcConn: null, child })
    return true
  } catch (err) {
    process.stderr.write(`daemon: spawn failed for ${uuid.slice(0, 8)}: ${err}\n`)
    return false
  }
}

async function startNew(ck: string, cwd: string): Promise<void> {
  const uuid = randomUUID()
  const ok = await spawnCC(uuid, cwd, false)
  if (!ok) {
    await adapterFor(ck)?.sendMessage(localId(ck), `❌ Failed to start session.`)
    return
  }
  const b = loadBindings()
  b[ck] = uuid
  saveBindings(b)
  await adapterFor(ck)?.sendMessage(localId(ck), `🚀 Session \`${uuid.slice(0, 8)}\` starting...`)
  process.stderr.write(`daemon: new ${uuid.slice(0, 8)} for ${ck}\n`)

  // Run escort to handle startup dialogs
  void startScreenWatch(ck, uuid)
}

async function resumeAndBind(ck: string, uuid: string): Promise<void> {
  const b = loadBindings()
  const prev = b[ck]
  if (prev && prev !== uuid) delete b[ck]
  b[ck] = uuid
  saveBindings(b)

  if (!live.has(uuid)) {
    const t = findTranscript(uuid)
    const cwd = t ? '/' + unsanitizePath(t.projectDir) : DEFAULT_CWD
    const ok = await spawnCC(uuid, cwd, true)
    if (!ok) {
      await adapterFor(ck)?.sendMessage(localId(ck), `❌ Failed to resume session.`)
      return
    }
    await adapterFor(ck)?.sendMessage(localId(ck), `▶️ Resuming \`${uuid.slice(0, 8)}\`...`)
    void startScreenWatch(ck, uuid)
  } else {
    await adapterFor(ck)?.sendMessage(localId(ck), `✅ Bound to \`${uuid.slice(0, 8)}\``)
  }
  process.stderr.write(`daemon: bound ${ck} → ${uuid.slice(0, 8)}\n`)
}

// ---------------------------------------------------------------------------
// Escort integration — handle CC startup dialogs via channel
// ---------------------------------------------------------------------------

/**
 * Send navigation buttons for CC startup dialogs. Stateless — no polling,
 * no timeout. Buttons carry pane_id, daemon handles clicks via send-keys.
 * IPC connection triggers a "ready" message separately.
 */
// ---------------------------------------------------------------------------
// Zellij WASM plugin — real-time screen watcher
// ---------------------------------------------------------------------------

const WASM_PLUGIN_PATH = (() => {
  const dist = join(import.meta.dir, 'zellij-plugin', 'dist', 'ccm-pane-watcher.wasm')
  const dev = join(import.meta.dir, 'zellij-plugin', 'target', 'wasm32-wasip1', 'release', 'ccm-pane-watcher.wasm')
  return existsSync(dist) ? dist : dev
})()
const SCREEN_DIR = '/tmp/ccm-screens'
let pluginLaunched = false

async function ensureWatcherPlugin(): Promise<void> {
  if (pluginLaunched || !zellijAvailable) return
  try {
    const { exec: execCb } = require('child_process') as typeof import('child_process')
    const { promisify } = require('util') as typeof import('util')
    const exec = promisify(execCb)
    // Launch in Tab #1 (keeper tab) so floating pane doesn't interfere with CC sessions.
    await exec(`zellij --session ${ZELLIJ_SESSION} action go-to-tab 1`, { encoding: 'utf8', timeout: 5000 })
    await exec(`zellij --session ${ZELLIJ_SESSION} action launch-plugin "file:${WASM_PLUGIN_PATH}" --floating`, { encoding: 'utf8', timeout: 5000 })
    await exec(`zellij --session ${ZELLIJ_SESSION} action toggle-floating-panes`, { encoding: 'utf8', timeout: 5000 })
    pluginLaunched = true
    process.stderr.write('daemon: watcher plugin launched\n')
  } catch {
    process.stderr.write('daemon: watcher plugin launch failed (will use polling fallback)\n')
  }
}

async function watchPane(paneId: number): Promise<void> {
  try {
    const { exec: execCb } = require('child_process') as typeof import('child_process')
    const { promisify } = require('util') as typeof import('util')
    const exec = promisify(execCb)
    await exec(`echo "watch:${paneId}" | zellij --session ${ZELLIJ_SESSION} pipe --plugin "file:${WASM_PLUGIN_PATH}"`, { encoding: 'utf8', timeout: 3000 })
    process.stderr.write(`daemon: watching pane ${paneId}\n`)
  } catch {}
}

function unwatchPane(paneId: number): void {
  try {
    const { execSync: ex } = require('child_process') as typeof import('child_process')
    ex(`echo "unwatch:${paneId}" | zellij --session ${ZELLIJ_SESSION} pipe --plugin "file:${WASM_PLUGIN_PATH}"`, { encoding: 'utf8', timeout: 3000 })
  } catch {}
}

// Active screen watchers: uuid → { watcher, lastContent, lastMsgId }
const screenWatchers = new Map<string, {
  watcher: ReturnType<typeof fsWatch> | null
  lastContent: string
  lastMsgId?: string
  channelKey: string
  paneId: number
}>()

/**
 * Start watching a CC session's screen for interactive dialogs.
 * Uses the zellij WASM plugin for real-time updates via file system.
 * Sends screen content + nav buttons to channel when changes detected.
 */
async function startScreenWatch(ck: string, uuid: string): Promise<void> {
  const adapter = adapterFor(ck)
  if (!adapter) return
  const u = uuid.slice(0, 8)

  // Find pane
  let paneId: number | null = null
  for (let i = 0; i < 20; i++) {
    paneId = resolvePaneId(u)
    if (paneId !== null) break
    await new Promise(r => setTimeout(r, 500))
  }
  if (paneId === null) return

  // Ensure plugin + start watching (async — don't block event loop)
  await ensureWatcherPlugin()
  await watchPane(paneId)

  const screenFile = join(SCREEN_DIR, `pane-${paneId}.screen`)

  const handleScreenChange = async () => {
    // Check if IPC connected — if so, stop watching
    const l = live.get(uuid)
    if (l?.ipcConn) {
      stopScreenWatch(uuid)
      return
    }

    // Always read fresh from zellij — not the file (avoids stale/timing issues)
    let content: string
    try { content = await dumpScreenAsync(paneId) } catch { return }

    const entry = screenWatchers.get(uuid)
    if (!entry || !content || content === entry.lastContent) return
    entry.lastContent = content

    // Clean: remove empty lines, trim
    const clean = content.split('\n').filter(l => l.trim()).join('\n').trim()
    if (!clean) return

    // Parse for interactive UI: detect selection options
    const options: string[] = []
    for (const line of clean.split('\n')) {
      const optMatch = line.match(/^\s*[❯›▸►]?\s*(\d+)\.\s+(.+)/)
      if (optMatch) options.push(optMatch[2].trim())
    }

    // Build message + buttons
    const msg = `🔧 \`${u}\`:\n\`\`\`\n${clean}\n\`\`\``
    const buttons: Array<{ text: string; data: string }> = []

    if (options.length > 0) {
      options.forEach((opt, i) => {
        buttons.push({ text: `${i + 1}. ${opt.slice(0, 30)}`, data: `nav:${u}:select:${i}` })
      })
    }
    buttons.push({ text: '↑', data: `nav:${u}:Up` })
    buttons.push({ text: '↓', data: `nav:${u}:Down` })
    buttons.push({ text: '✓ Enter', data: `nav:${u}:Enter` })
    buttons.push({ text: '✕ Esc', data: `nav:${u}:Escape` })

    const id = localId(ck)
    if (entry.lastMsgId) {
      // Edit existing message
      try { await adapter.editMessage(id, entry.lastMsgId, msg) } catch {}
    } else {
      entry.lastMsgId = await sendWithButtonsReturn(ck, msg, buttons)
    }
  }

  // Event-based: fs.watch on screen file triggers handleScreenChange.
  // handleScreenChange reads fresh from dumpScreen (not the file), so no stale data.
  // Pre-create the file so fs.watch can start immediately — no polling needed.
  let watcher: ReturnType<typeof fsWatch> | null = null
  try {
    try { mkdirSync(SCREEN_DIR, { recursive: true }) } catch {}
    try { writeFileSync(screenFile, '') } catch {}
    watcher = fsWatch(screenFile, { persistent: false }, () => void handleScreenChange())
  } catch {}

  screenWatchers.set(uuid, { watcher, lastContent: '', channelKey: ck, paneId })

  // One initial check — catches content if plugin wrote before fs.watch was ready
  await new Promise(r => setTimeout(r, 1000))
  await handleScreenChange()
}

function stopScreenWatch(uuid: string): void {
  const entry = screenWatchers.get(uuid)
  if (!entry) return
  entry.watcher?.close()
  unwatchPane(entry.paneId)
  screenWatchers.delete(uuid)
  process.stderr.write(`daemon: stopped watching ${uuid.slice(0, 8)}\n`)
}

/** sendWithButtons but returns message ID */
async function sendWithButtonsReturn(ck: string, text: string, buttons: Array<{ text: string; data: string }>): Promise<string | undefined> {
  const adapter = adapterFor(ck)
  const id = localId(ck)
  if (!adapter) return undefined
  const opts = adapter.renderButtons(buttons)
  return await adapter.sendMessage(id, text, opts)
}

/** Resolve pane_id from UUID short at click time */
function resolvePaneId(uuidShort: string): number | null {
  const pane = findPaneByTabName(`ccm:${uuidShort}`)
  return pane ? pane.paneId : null
}

/** Navigate to option index and confirm. Event-based: each step verifies screen changed. */
async function navigateAndConfirm(paneId: number, targetIdx: number): Promise<void> {
  // Go to top
  for (let i = 0; i < 10; i++) {
    const before = dumpScreen(paneId)
    sendKeys(paneId, 'Up')
    if (!await waitForChange(paneId, before)) break  // at top
  }
  // Navigate down to target
  for (let i = 0; i < targetIdx; i++) {
    const before = dumpScreen(paneId)
    sendKeys(paneId, 'Down')
    await waitForChange(paneId, before)
  }
  // Confirm
  sendKeys(paneId, 'Enter')
}

async function waitForChange(paneId: number, before: string, timeoutMs = 2000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 100))
    if (dumpScreen(paneId) !== before) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Session cleanup
// ---------------------------------------------------------------------------

function killSession(uuid: string): void {
  const l = live.get(uuid)
  if (!l) return
  if (l.child) {
    l.child.kill('SIGTERM')
  } else if (zellijAvailable) {
    // Zellij mode: close the tab which kills the process inside it
    try {
      closeTab(`ccm:${uuid.slice(0, 8)}`)
      l.ipcConn?.destroy()
    } catch {}
  }
  live.delete(uuid)
  socketToUuid.forEach((u, s) => { if (u === uuid) socketToUuid.delete(s) })
}

function unbind(ck: string): { uuid: string; remaining: number } | null {
  const b = loadBindings()
  const uuid = b[ck]
  if (!uuid) return null
  delete b[ck]
  saveBindings(b)
  const remaining = Object.values(b).filter(v => v === uuid).length
  if (remaining === 0) killSession(uuid)
  return { uuid, remaining }
}

// ---------------------------------------------------------------------------
// Magic word parsing
// ---------------------------------------------------------------------------

type Cmd =
  | { t: 'new'; cwd: string }
  | { t: 'resume_pick' }
  | { t: 'resume_id'; uuid: string }
  | { t: 'stop' }
  | { t: 'stop_id'; uuid: string }
  | { t: 'help' }
  | { t: 'find'; query: string }
  | { t: 'slash'; command: string }
  | { t: 'msg'; text: string }

function parseCmd(text: string): Cmd {
  const c = text.replace(/<@[A-Z0-9]+>/g, '').trim()

  // /ccm xxx — native slash command form (Telegram /ccm_help, Slack /ccm help)
  // Also match plain ccm xxx
  const ccmMatch = c.match(/^\/ccm[\s_]*(.*)/i) ?? c.match(/^ccm\s*(.*)/i)
  if (ccmMatch) {
    const args = ccmMatch[1].trim()
    if (!args) return { t: 'new', cwd: DEFAULT_CWD }
    if (/^help$/i.test(args)) return { t: 'help' }
    const findM = args.match(/^find\s+(.+)$/i)
    if (findM) return { t: 'find', query: findM[1].trim() }
    const stopIdM = args.match(/^stop\s+([0-9a-f-]{8,36})$/i)
    if (stopIdM) return { t: 'stop_id', uuid: stopIdM[1] }
    if (/^stop$/i.test(args)) return { t: 'stop' }
    const resumeIdM = args.match(/^resume\s+([0-9a-f-]{8,36})$/i)
    if (resumeIdM) return { t: 'resume_id', uuid: resumeIdM[1] }
    if (/^resume$/i.test(args)) return { t: 'resume_pick' }
    const pathM = args.match(/^(\/\S+)$/i)
    if (pathM) return { t: 'new', cwd: pathM[1] }
    return { t: 'new', cwd: DEFAULT_CWD }
  }

  // /cc xxx — CC slash command (native form)
  const ccMatch = c.match(/^\/cc[\s_]+(.+)/i)
  if (ccMatch) return { t: 'slash', command: '/' + ccMatch[1].trim() }

  return { t: 'msg', text: c }
}

// ---------------------------------------------------------------------------
// Session picker
// ---------------------------------------------------------------------------

function formatAge(ms: number): string {
  const d = Date.now() - ms
  if (d < 60000) return 'now'
  if (d < 3600000) return `${Math.floor(d / 60000)}m`
  if (d < 86400000) return `${Math.floor(d / 3600000)}h`
  return `${Math.floor(d / 86400000)}d`
}

/** Send a message with inline action buttons (cross-platform via adapter) */
async function sendWithButtons(ck: string, text: string, buttons: Array<{ text: string; data: string }>): Promise<void> {
  const adapter = adapterFor(ck)
  const id = localId(ck)
  if (!adapter) return
  const opts = adapter.renderButtons(buttons)
  await adapter.sendMessage(id, text, opts)
}

/** Level 1: list folders that have sessions */
async function sendPicker(ck: string, page = 0): Promise<void> {
  const sessions = listAllCCSessions(100)
  if (sessions.length === 0) {
    await sendWithButtons(ck, 'No sessions found.', [{ text: '🚀 Start new session', data: 'cmd:new' }])
    return
  }

  // Group by cwd
  const groups = new Map<string, SessionInfo[]>()
  for (const s of sessions) {
    const dir = s.cwd ?? '~'
    if (!groups.has(dir)) groups.set(dir, [])
    groups.get(dir)!.push(s)
  }

  // Sort groups by most recent session
  const sortedDirs = [...groups.entries()]
    .sort((a, b) => Math.max(...b[1].map(s => s.mtime)) - Math.max(...a[1].map(s => s.mtime)))

  const adapter = adapterFor(ck)
  const ps = adapter?.pageSize ?? 20
  const totalPages = Math.max(1, Math.ceil(sortedDirs.length / ps))
  const pageDirs = sortedDirs.slice(page * ps, (page + 1) * ps)

  const headerLines: string[] = [`📋 ${sessions.length} sessions in ${groups.size} folders`]
  if (totalPages > 1) headerLines[0] += ` · Page ${page + 1}/${totalPages}`

  // Each folder as a picker item with info in button text
  const pickerItems = pageDirs.map(([dir, items]) => {
    const activeCount = items.filter(s => live.has(s.uuid)).length
    const indicator = activeCount > 0 ? '▶️' : '📂'
    return { label: `${indicator} ${dir} (${items.length})`, value: dir }
  })

  const opts = adapter!.renderListPicker(pickerItems, page, totalPages, 'ses:folder:')
  await adapter!.sendMessage(localId(ck), headerLines.join('\n'), opts)
}

/** Level 2: list sessions in a specific folder */
async function sendFolderSessions(ck: string, dir: string, page = 0): Promise<void> {
  const ccmUuids = new Set(Object.values(loadBindings()))
  const sessions = listAllCCSessions(200).filter(s => (s.cwd ?? '~') === dir)

  if (sessions.length === 0) {
    await sendWithButtons(ck, `No sessions in \`${dir}\`.`, [{ text: '🔙 Back', data: 'cmd:resume' }])
    return
  }

  const adapter = adapterFor(ck)
  const id = localId(ck)
  if (!adapter) return

  sessions.sort((a, b) => b.mtime - a.mtime)

  const ps = adapter.pageSize
  const pages = Math.ceil(sessions.length / ps)
  const pageSessions = sessions.slice(page * ps, (page + 1) * ps)

  // Header: path + page info
  const header = `📂 ${dir}` + (pages > 1 ? ` · ${sessions.length} sessions · Page ${page + 1}/${pages}` : `\n${sessions.length} session(s)`)

  // Each session as a picker item with info in button text
  const pickerItems = pageSessions.map(s => {
    const active = live.has(s.uuid) ? '🟢' : ccmUuids.has(s.uuid) ? '🔵' : '⚪'
    const age = s.mtime ? formatAge(s.mtime) : '?'
    const chans = channelsForUuid(s.uuid)
    const chanLabel = chans.length > 0 ? ' · ' + chans.map(c => c.split(':')[0]).join(',') : ''
    const title = s.title ? ` · ${s.title}` : ''
    return { label: `${active} ${s.uuid.slice(0, 8)} · ${age}${title}${chanLabel}`, value: s.uuid }
  })

  // Nav items (Back, Prev, Next) — typed as 'nav' for adapter mixed rendering
  pickerItems.unshift({ label: '🔙 Back', value: 'cmd:resume', type: 'nav' as const })
  if (pages > 1 && page > 0) pickerItems.unshift({ label: '⬅️', value: `__fpage:${dir}:${page - 1}`, type: 'nav' as const })
  if (pages > 1 && page < pages - 1) pickerItems.push({ label: '➡️', value: `__fpage:${dir}:${page + 1}`, type: 'nav' as const })

  const opts = adapter.renderListPicker(pickerItems, 0, 1, 'ccr:')
  await adapter.sendMessage(id, header, opts)
}

// ---------------------------------------------------------------------------
// Directory picker — recent dirs + interactive browser
// ---------------------------------------------------------------------------

async function sendDirPicker(ck: string): Promise<void> {
  const buttons: Array<{ text: string; data: string }> = []

  // Home quick start
  buttons.push({ text: `🏠 Home`, data: `dir:start:${DEFAULT_CWD}` })

  // Recent dirs as a single button that expands
  buttons.push({ text: '⏱ Recent dirs', data: 'cmd:recentdirs' })

  // Browse + Search
  buttons.push({ text: '📂 Browse', data: `dir:browse:${DEFAULT_CWD}:0` })
  buttons.push({ text: '🔎 Search', data: 'cmd:search' })

  await sendWithButtons(ck, '📂 Choose working directory:', buttons)
}

async function sendRecentDirs(ck: string): Promise<void> {
  const sessions = listAllCCSessions(30)
  const dirCounts = new Map<string, number>()
  for (const s of sessions) {
    if (s.cwd) {
      const dir = '/' + s.cwd
      dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1)
    }
  }
  const recentDirs = [...dirCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  if (recentDirs.length === 0) {
    await sendWithButtons(ck, 'No recent directories.', [
      { text: '🔍 Browse', data: `dir:browse:${DEFAULT_CWD}:0` },
    ])
    return
  }

  const buttons = recentDirs.map(([dir, count]) => ({
    text: `📁 ${basename(dir)} (${count}×)`,
    data: `dir:start:${dir}`,
  }))
  buttons.push({ text: '🔍 Browse...', data: `dir:browse:${DEFAULT_CWD}:0` })

  await sendWithButtons(ck, '⏱ Recent directories:', buttons)
}

// Directory browser uses adapter.pageSize too

// Alphabet ranges for jump buttons
const ALPHA_RANGES = [
  { label: '.', filter: (n: string) => n.startsWith('.') },
  { label: 'A-F', filter: (n: string) => { const c = n[0]?.toUpperCase(); return c !== undefined && c >= 'A' && c <= 'F' } },
  { label: 'G-L', filter: (n: string) => { const c = n[0]?.toUpperCase(); return c !== undefined && c >= 'G' && c <= 'L' } },
  { label: 'M-R', filter: (n: string) => { const c = n[0]?.toUpperCase(); return c !== undefined && c >= 'M' && c <= 'R' } },
  { label: 'S-Z', filter: (n: string) => { const c = n[0]?.toUpperCase(); return c !== undefined && c >= 'S' && c <= 'Z' } },
  { label: '0-9', filter: (n: string) => /^[0-9]/.test(n) },
]

/**
 * Directory browser. Three modes via `filter` param:
 *   undefined → show alphabet jump + recent (first page)
 *   "all"     → paginated full listing
 *   "A-F"     → filtered by alphabet range
 */
async function sendDirBrowser(ck: string, dir: string, page = 0, filter?: string): Promise<void> {
  const adapter = adapterFor(ck)
  const dirPs = adapter?.pageSize ?? 20
  const id = localId(ck)
  if (!adapter) return

  let allEntries: string[]
  try {
    allEntries = readdirSync(dir)
      .filter(name => {
        try { return statSync(join(dir, name)).isDirectory() } catch { return false }
      })
      .sort()
  } catch {
    await sendWithButtons(ck, `❌ Cannot read \`${dir}\``, [{ text: '🔙 Back', data: `dir:browse:${join(dir, '..')}:0` }])
    return
  }

  // Apply alphabet filter
  let filtered = allEntries
  let filterLabel = ''
  if (filter && filter !== 'all') {
    const range = ALPHA_RANGES.find(r => r.label === filter)
    if (range) {
      filtered = allEntries.filter(range.filter)
      filterLabel = ` [${filter}]`
    }
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / dirPs))
  const entries = filtered.slice(page * dirPs, (page + 1) * dirPs)
  const showAlpha = allEntries.length > dirPs && !filter

  const text = `📂 \`${dir}\`\n${allEntries.length} folders${filterLabel}${totalPages > 1 ? ` · ${page + 1}/${totalPages}` : ''}`

  // Build button groups
  const topButtons: Array<{ text: string; data: string }> = [{ text: `✅ Use here`, data: `dir:start:${dir}` }]
  if (dir !== '/') topButtons.push({ text: '🔙 Up', data: `dir:browse:${join(dir, '..')}:0` })

  const filterButtons: Array<{ text: string; data: string }> = []
  if (showAlpha) {
    for (const r of ALPHA_RANGES) {
      if (allEntries.some(r.filter)) filterButtons.push({ text: r.label, data: `dir:filter:${dir}:${r.label}` })
    }
  }
  if (filter) filterButtons.push({ text: '🔄 Show all', data: `dir:browse:${dir}:0` })

  const gridItems = entries.map(name => ({ text: `📁 ${name}`, data: `dir:browse:${join(dir, name)}:0` }))

  const bottomButtons: Array<{ text: string; data: string }> = []
  if (totalPages > 1) {
    if (page > 0) bottomButtons.push({ text: '⬅️', data: `dir:${filter ? `filter:${dir}:${filter}` : `browse:${dir}`}:${page - 1}` })
    bottomButtons.push({ text: `${page + 1}/${totalPages}`, data: 'noop' })
    if (page < totalPages - 1) bottomButtons.push({ text: '➡️', data: `dir:${filter ? `filter:${dir}:${filter}` : `browse:${dir}`}:${page + 1}` })
  }

  const opts = adapter.renderGrid({ topButtons, filterButtons, gridItems, bottomButtons })
  await adapter.sendMessage(id, text, opts)
}

async function sendFindResults(ck: string, query: string): Promise<void> {
  const { execSync: ex } = require('child_process') as typeof import('child_process')
  let results: string[] = []
  try {
    // find directories matching query (case-insensitive, max depth 4, max 20 results)
    const out = ex(
      `find ${DEFAULT_CWD} -maxdepth 4 -type d -iname '*${query.replace(/'/g, '')}*' 2>/dev/null | head -20`,
      { encoding: 'utf8', timeout: 5000 },
    )
    results = out.trim().split('\n').filter(Boolean)
  } catch {}

  if (results.length === 0) {
    await sendWithButtons(ck, `🔍 No directories matching "${query}".`, [
      { text: '🔍 Browse', data: `dir:browse:${DEFAULT_CWD}:0` },
    ])
    return
  }

  const buttons = results.slice(0, 10).map(dir => ({
    text: `📁 ${dir.replace(DEFAULT_CWD + '/', '')}`,
    data: `dir:start:${dir}`,
  }))
  buttons.push({ text: '🔍 Browse', data: `dir:browse:${DEFAULT_CWD}:0` })

  await sendWithButtons(ck, `🔍 Found ${results.length} match${results.length > 1 ? 'es' : ''} for "${query}":`, buttons)
}

async function sendStopPicker(ck: string): Promise<void> {
  const sessions = listSessions().filter(s => live.has(s.uuid))
  if (sessions.length === 0) {
    await sendWithButtons(ck, 'No active sessions to stop.', [{ text: '🚀 Start new session', data: 'cmd:new' }])
    return
  }

  const buttons = sessions.map(s => {
    const chans = channelsForUuid(s.uuid).map(c => c.split(':').slice(1).join(':')).join(', ')
    return { text: `⏹ ${s.uuid.slice(0, 8)} · ${chans || '—'}`, data: `cmd:stopnow:${s.uuid}` }
  })

  await sendWithButtons(ck, '⏹ Select session to stop:', buttons)
}

// ---------------------------------------------------------------------------
// Unified inbound handler
// ---------------------------------------------------------------------------

async function onMessage(ck: string, msg: InboundMessage): Promise<void> {
  const cmd = parseCmd(msg.text)
  const adapter = adapterFor(ck)
  const id = localId(ck)

  switch (cmd.t) {
    case 'help': {
      const bindings = loadBindings()
      const bound = bindings[ck]

      // Status section
      const statusLines: string[] = ['*claude-channel-mux*', '']
      if (bound) {
        const t = findTranscript(bound)
        const isAlive = live.has(bound)
        const channels = channelsForUuid(bound)
        const otherChannels = channels.filter(c => c !== ck)
        statusLines.push(`*Current session:* \`${bound.slice(0, 8)}\` ${isAlive ? '🟢 active' : '🔵 suspended'}`)
        statusLines.push(`*Directory:* \`${t ? '/' + unsanitizePath(t.projectDir) : '~'}\``)
        if (otherChannels.length > 0) {
          statusLines.push(`*Also connected:* ${otherChannels.join(', ')}`)
        }
        statusLines.push('')
      } else {
        statusLines.push('_No session on this channel_', '')
      }

      // Commands
      statusLines.push(
        '*Commands:*',
        '`ccm` — New session',
        '`ccm resume` — Browse & resume',
        '`ccm stop` — Disconnect / stop',
        '`ccm find <query>` — Search directories',
        '`!command` — CC slash command (e.g. `!compact`, `!exit`)',
        '`ccm help` — This info',
      )

      const helpButtons: Array<{ text: string; data: string }> = [
        { text: '🚀 New', data: 'cmd:new' },
        { text: '📋 Resume', data: 'cmd:resume' },
        { text: '⏹ Stop', data: 'cmd:stop' },
      ]
      await sendWithButtons(ck, statusLines.join('\n'), helpButtons)
      return
    }
    case 'find': {
      await sendFindResults(ck, cmd.query)
      return
    }
    case 'slash': {
      // Send CC slash command directly to zellij terminal (not through channel)
      const b = loadBindings()
      const uuid = b[ck]
      if (!uuid) {
        await sendWithButtons(ck, 'No session on this channel.', [{ text: '🚀 New', data: 'cmd:new' }])
        return
      }
      const paneId = resolvePaneId(uuid.slice(0, 8))
      if (paneId === null) {
        await sendWithButtons(ck, `Session \`${uuid.slice(0, 8)}\` not running.`, [
          { text: `▶️ Resume`, data: `ccr:${uuid}` },
        ])
        return
      }
      // Import writeChars from escort
      const { writeChars } = await import('./escort.js')
      writeChars(paneId, cmd.command)
      sendKeys(paneId, 'Enter')
      await adapter?.sendMessage(id, `⚡ Sent \`${cmd.command}\` to session.`)
      return
    }
    case 'new': {
      const existing = loadBindings()[ck]
      if (existing && live.has(existing)) {
        await sendWithButtons(ck, `⚠️ Channel bound to active session \`${existing.slice(0, 8)}\`.`, [
          { text: `▶️ Resume ${existing.slice(0, 8)}`, data: `ccr:${existing}` },
          { text: '⏹ Stop & start new', data: `cmd:stopnew:${existing}` },
        ])
        return
      }
      if (cmd.cwd === DEFAULT_CWD) {
        // Bare ccm → show recent directories + browse
        await sendDirPicker(ck)
      } else {
        await startNew(ck, cmd.cwd)
      }
      return
    }
    case 'resume_pick':
      await sendPicker(ck)
      return
    case 'resume_id': {
      let uuid = cmd.uuid
      if (uuid.length < 36) {
        const match = listSessions().find(s => s.uuid.startsWith(uuid))
        if (!match) {
          await sendWithButtons(ck, `❌ No session matching \`${uuid}\`.`, [
            { text: '📋 Browse sessions', data: 'cmd:resume' },
            { text: '🚀 Start new', data: 'cmd:new' },
          ])
          return
        }
        uuid = match.uuid
      }
      await resumeAndBind(ck, uuid)
      return
    }
    case 'stop': {
      const b = loadBindings()
      const uuid = b[ck]
      if (uuid) {
        const result = unbind(ck)
        if (result) {
          if (result.remaining === 0) {
            await sendWithButtons(ck, `⏹ Session \`${result.uuid.slice(0, 8)}\` suspended.`, [
              { text: `▶️ Resume`, data: `ccr:${result.uuid}` },
              { text: '🚀 Start new', data: 'cmd:new' },
            ])
          } else {
            await sendWithButtons(ck, `⏹ Unbound from \`${result.uuid.slice(0, 8)}\` (still active on other channels).`, [
              { text: `▶️ Reconnect`, data: `ccr:${result.uuid}` },
            ])
          }
        }
      } else {
        await sendStopPicker(ck)
      }
      return
    }
    case 'stop_id': {
      let uuid = cmd.uuid
      if (uuid.length < 36) {
        const match = listSessions().find(s => s.uuid.startsWith(uuid))
        if (!match) {
          await sendWithButtons(ck, `❌ No session matching \`${uuid}\`.`, [
            { text: '📋 Browse sessions', data: 'cmd:resume' },
          ])
          return
        }
        uuid = match.uuid
      }
      const b = loadBindings()
      const channels = Object.entries(b).filter(([, v]) => v === uuid).map(([k]) => k)
      for (const c of channels) delete b[c]
      saveBindings(b)
      killSession(uuid)
      await sendWithButtons(ck, `⏹ Stopped session \`${uuid.slice(0, 8)}\` (${channels.length} channel(s) unbound).`, [
        { text: `▶️ Resume`, data: `ccr:${uuid}` },
        { text: '🚀 Start new', data: 'cmd:new' },
      ])
      return
    }
    case 'msg': {
      const b = loadBindings()
      const uuid = b[ck]
      if (!uuid) return

      const l = live.get(uuid)
      if (!l) {
        await sendWithButtons(ck, `Session \`${uuid.slice(0, 8)}\` suspended.`, [
          { text: `▶️ Resume`, data: `ccr:${uuid}` },
          { text: '🚀 Start new', data: 'cmd:new' },
        ])
        return
      }
      if (!l.ipcConn) {
        let waited = 0
        while (!l.ipcConn && waited < 10000) {
          await new Promise(r => setTimeout(r, 500))
          waited += 500
        }
        if (!l.ipcConn) {
          await sendWithButtons(ck, '⏳ Session starting up.', [
            { text: '🔄 Retry', data: `cmd:retry:${uuid}` },
          ])
          return
        }
      }

      // Ack: react to the message + show typing
      adapter?.addReaction(id, msg.messageId, '👀').catch(() => {})
      adapter?.showTyping?.(id).catch(() => {})
      lastInboundMsg.set(ck, msg.messageId)

      sendToLive(uuid, {
        type: 'inbound',
        channelKey: ck,
        content: cmd.text,
        meta: {
          ...msg.meta,
          chat_id: ck,
          message_id: msg.messageId,
          user: msg.userName,
          user_id: msg.userId,
          ...(msg.replyToId ? { reply_to_id: msg.replyToId } : {}),
        },
      })
      return
    }
  }
}

// ---------------------------------------------------------------------------
// Tool execution via IPC
// ---------------------------------------------------------------------------

async function handleTool(msg: { tool: string; args: Record<string, unknown>; callId: string }, uuid: string): Promise<void> {
  try {
    let result: string
    const ck = msg.args.chat_id as string
    const adapter = adapterFor(ck)
    const id = localId(ck)
    if (!adapter) throw new Error(`No adapter for ${ck}`)

    switch (msg.tool) {
      case 'reply': {
        const ts = await adapter.sendMessage(id, msg.args.text as string, {
          replyTo: msg.args.reply_to as string | undefined,
          broadcast: true,  // Slack: also send to channel when replying in thread
        })
        for (const f of (msg.args.files as string[] ?? []))
          await adapter.uploadFile(id, f, basename(f))

        result = `sent (id: ${ts})`
        break
      }
      case 'react':
        await adapter.addReaction(id, msg.args.message_id as string, msg.args.emoji as string)
        result = 'reacted'
        break
      case 'edit_message':
        await adapter.editMessage(id, msg.args.message_id as string, msg.args.text as string)
        result = 'updated'
        break
      case 'download_attachment':
        result = await adapter.downloadFile(msg.args.file_id as string)
        break
      case 'fetch_thread': {
        if (!adapter.fetchThread) {
          result = 'Thread history not supported on this platform.'
          break
        }
        const threadMsgs = await adapter.fetchThread(id, msg.args.thread_id as string)
        result = threadMsgs.map(m => `[${m.ts}] ${m.userName}: ${m.text}`).join('\n')
        break
      }
      default:
        throw new Error(`unknown tool: ${msg.tool}`)
    }
    sendToLive(uuid, { type: 'tool_result', callId: msg.callId, result })
  } catch (err) {
    sendToLive(uuid, { type: 'tool_error', callId: msg.callId, error: (err as Error).message })
  }
}

// ---------------------------------------------------------------------------
// Permission request → inline keyboard
// ---------------------------------------------------------------------------

async function handlePermissionRequest(
  msg: { request_id: string; tool_name: string; description: string; input_preview: string; channels: string[] },
  uuid: string,
): Promise<void> {
  const { request_id, tool_name, description, input_preview } = msg
  const channels = msg.channels ?? channelsForUuid(uuid)

  const preview = tool_name === 'Bash' ? `\n\`\`\`\n${input_preview.slice(0, 200)}\n\`\`\`\n` : ''
  const text = `🔐 *${tool_name}*: ${description}${preview}`

  for (const ck of channels) {
    const adapter = adapterFor(ck)
    const id = localId(ck)
    if (!adapter) continue

    const buttons = [
      { text: '✅ Allow', data: `perm:${uuid}:${request_id}:allow` },
      { text: '❌ Deny', data: `perm:${uuid}:${request_id}:deny` },
    ]
    const opts = adapter.renderButtons(buttons)
    await adapter.sendMessage(id, text, opts).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// IPC server
// ---------------------------------------------------------------------------

if (existsSync(SOCK_PATH)) try { unlinkSync(SOCK_PATH) } catch {}

const ipc: NetServer = createServer((conn: Socket) => {
  let buf = ''
  conn.on('data', (chunk: Buffer) => {
    buf += chunk.toString()
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let msg: any
      try { msg = JSON.parse(line) } catch { continue }

      if (msg.type === 'register') {
        const uuid = msg.uuid as string
        let l = live.get(uuid)

        // Auto-recover: if UUID is in bindings but not in live (daemon restarted),
        // create a live entry to accept the reconnecting session
        if (!l) {
          const bindings = loadBindings()
          const hasBound = Object.values(bindings).includes(uuid)
          if (hasBound) {
            l = { ipcConn: null, child: null }
            live.set(uuid, l)
            process.stderr.write(`daemon: auto-recovered session ${uuid.slice(0, 8)} from bindings\n`)
          }
        }

        if (l) {
          l.ipcConn = conn
          socketToUuid.set(conn, uuid)
          sendToLive(uuid, { type: 'registered', uuid, channels: channelsForUuid(uuid) })
          process.stderr.write(`daemon: IPC registered ${uuid.slice(0, 8)}\n`)
          stopScreenWatch(uuid)
          for (const ch of channelsForUuid(uuid)) {
            const a = adapterFor(ch)
            if (a) a.sendMessage(localId(ch), `✅ Session \`${uuid.slice(0, 8)}\` reconnected.`).catch(() => {})
          }
        }
      } else if (msg.type === 'tool_call') {
        const uuid = socketToUuid.get(conn)
        if (uuid) void handleTool(msg, uuid)
      } else if (msg.type === 'permission_request') {
        const uuid = socketToUuid.get(conn)
        if (uuid) void handlePermissionRequest(msg, uuid)
      } else if (msg.type === 'ping') {
        try { conn.write('{"type":"pong"}\n') } catch {}
      }
    }
  })
  conn.on('close', () => {
    const uuid = socketToUuid.get(conn)
    if (uuid) {
      const l = live.get(uuid)
      if (l) {
        l.ipcConn = null
        if (zellijAvailable) {
          // Zellij mode: session lives in a tab, not as a child process.
          // IPC disconnect just means server.ts disconnected — session may still be alive.
          // Keep the live entry so it can reconnect. Only remove if pane is actually dead.
          const pane = findPaneByTabName(`ccm:${uuid.slice(0, 8)}`)
          if (!pane || pane.exited) {
            live.delete(uuid)
            process.stderr.write(`daemon: session ${uuid.slice(0, 8)} pane dead, removed from live\n`)
          } else {
            process.stderr.write(`daemon: session ${uuid.slice(0, 8)} IPC closed, pane still alive\n`)
          }
        } else if (!l.child) {
          live.delete(uuid)
          process.stderr.write(`daemon: session ${uuid.slice(0, 8)} IPC closed, removed from live\n`)
        }
      }
    }
    socketToUuid.delete(conn)
  })
  conn.on('error', () => {})
})

ipc.listen(SOCK_PATH, () => {
  try { chmodSync(SOCK_PATH, 0o600) } catch {}
  process.stderr.write(`daemon: IPC on ${SOCK_PATH}\n`)
})

writeFileSync(PID_FILE, String(process.pid), { mode: 0o600 })

// ---------------------------------------------------------------------------
// Start adapters + wire up handlers
// ---------------------------------------------------------------------------

for (const adapter of activeAdapters) {
  adapter.onMessage(msg => {
    const ck = `${adapter.platform}:${msg.channelId}`
    return onMessage(ck, msg)
  })

  adapter.onSearch((channelId, query) => {
    const ck = `${adapter.platform}:${channelId}`
    void sendFindResults(ck, query)
  })

  adapter.onInteraction(async (interaction) => {
    const ck = `${adapter.platform}:${interaction.channelId}`
    const data = interaction.data
    if (data === 'ccr:cmd:resume') {
      await sendPicker(ck)
    } else if (data === 'ccr:__noop') {
      // Do nothing (page number display button)
    } else if (data.startsWith('ccr:__fpage:')) {
      // Folder session pagination: ccr:__fpage:<dir>:<page>
      const rest = data.slice(12)
      const lastColon = rest.lastIndexOf(':')
      const dir = rest.slice(0, lastColon)
      const pg = parseInt(rest.slice(lastColon + 1))
      await sendFolderSessions(ck, dir, pg)
    } else if (data.startsWith('ccr:')) {
      await resumeAndBind(ck, data.slice(4))
    } else if (data.startsWith('ccp:')) {
      await sendPicker(ck, parseInt(data.slice(4)))
    } else if (data.startsWith('ses:folder:')) {
      await sendFolderSessions(ck, data.slice(11))
    } else if (data.startsWith('ses:page:')) {
      await sendPicker(ck, parseInt(data.slice(9)))
    } else if (data.startsWith('nav:')) {
      const parts = data.split(':')
      const uuidShort = parts[1]
      const paneId = resolvePaneId(uuidShort)
      if (paneId !== null) {
        // Instant feedback: edit the button message to show "processing" (removes old buttons)
        const adapter = adapterFor(ck)
        const wEntry = screenWatchers.get(uuidShort.length === 8 ?
          [...screenWatchers.keys()].find(k => k.startsWith(uuidShort)) ?? '' : '')
        // For Telegram: answerCallbackQuery would be ideal but we don't have the callback_query_id here
        // Instead, send a quick status
        await adapter?.sendMessage(localId(ck), `⏳`).catch(() => {})

        const action = parts.slice(2).join(':')
        if (action.startsWith('select:')) {
          await navigateAndConfirm(paneId, parseInt(action.slice(7)))
        } else {
          sendKeys(paneId, action)
        }
        // Screen update handled by watcher plugin automatically via fs.watch
      }
    } else if (data.startsWith('perm:')) {
      const parts = data.split(':')
      if (parts.length >= 4) {
        const uuid = parts[1]
        const requestId = parts[2]
        const behavior = parts[3] as 'allow' | 'deny'
        sendToLive(uuid, { type: 'permission_response', request_id: requestId, behavior })
      }
    } else if (data.startsWith('dir:start:')) {
      const dir = data.slice(10)
      unbind(ck)
      await startNew(ck, dir)
    } else if (data.startsWith('dir:filter:')) {
      // dir:filter:/path:RANGE:page  or  dir:filter:/path:RANGE
      const rest = data.slice(11)
      // Parse from end: last segment might be page number
      const parts = rest.split(':')
      const maybePage = parseInt(parts[parts.length - 1])
      if (!isNaN(maybePage) && parts.length >= 3) {
        const filterRange = parts[parts.length - 2]
        const dirPath = parts.slice(0, -2).join(':')
        await sendDirBrowser(ck, dirPath, maybePage, filterRange)
      } else {
        // No page: dir:filter:/path:RANGE
        const filterRange = parts[parts.length - 1]
        const dirPath = parts.slice(0, -1).join(':')
        await sendDirBrowser(ck, dirPath, 0, filterRange)
      }
    } else if (data.startsWith('dir:browse:')) {
      // dir:browse:/path:page
      const rest = data.slice(11)
      const lastColon = rest.lastIndexOf(':')
      const pageNum = parseInt(rest.slice(lastColon + 1))
      if (!isNaN(pageNum) && lastColon > 0) {
        await sendDirBrowser(ck, rest.slice(0, lastColon), pageNum)
      } else {
        await sendDirBrowser(ck, rest, 0)
      }
    } else if (data.startsWith('cmd:')) {
      const action = data.slice(4)
      if (action === 'new') {
        await onMessage(ck, { channelId: interaction.channelId, userId: '', userName: '', text: 'ccm', messageId: '', meta: {} })
      } else if (action === 'stop') {
        await onMessage(ck, { channelId: interaction.channelId, userId: '', userName: '', text: 'ccm stop', messageId: '', meta: {} })
      } else if (action === 'search') {
        // Trigger platform-native search prompt
        // Slack: modal opened by adapter's interactive handler directly
        // Telegram: force_reply
        await adapter?.promptSearch(localId(ck), 'Type directory name to search')
      } else if (action === 'recentdirs') {
        await sendRecentDirs(ck)
      } else if (action === 'resume') {
        await sendPicker(ck)
      } else if (action.startsWith('stopnew:')) {
        const uuid = action.slice(8)
        unbind(ck)
        killSession(uuid)
        await onMessage(ck, { channelId: interaction.channelId, userId: '', userName: '', text: 'ccm', messageId: '', meta: {} })
      } else if (action.startsWith('retry:')) {
        const uuid = action.slice(6)
        await resumeAndBind(ck, uuid)
      } else if (action.startsWith('stop:')) {
        const uuid = action.slice(5)
        killSession(uuid)
        live.delete(uuid)
      } else if (action.startsWith('browse:')) {
        await sendDirBrowser(ck, action.slice(7), 0)
      } else if (action.startsWith('stopnow:')) {
        // Stop + unbind from help button
        const uuid = action.slice(8)
        unbind(ck)
        killSession(uuid)
        await sendWithButtons(ck, `⏹ Session \`${uuid.slice(0, 8)}\` stopped.`, [
          { text: `▶️ Resume`, data: `ccr:${uuid}` },
          { text: '🚀 Start new', data: 'cmd:new' },
        ])
      }
    }
  })

  await adapter.start()
}

process.stderr.write(`daemon: ready (${activeAdapters.map(a => a.platform).join(', ')})\n`)

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

let shuttingDown = false
async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  process.stderr.write('daemon: shutting down\n')
  for (const [uuid] of live) killSession(uuid)
  for (const a of activeAdapters) await a.stop().catch(() => {})
  try { unlinkSync(SOCK_PATH) } catch {}
  try { unlinkSync(PID_FILE) } catch {}
  ipc.close()
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
