/**
 * Escort mode — shepherds a CC session through startup dialogs.
 *
 * After spawning CC in a zellij tab, polls dump-screen to detect interactive
 * UI (trust dialog, dev-channels confirm, permission mode, auto-mode opt-in).
 * Renders detected prompts as inline keyboard buttons in Slack/Telegram.
 * User taps a button → send-keys to the zellij pane. Repeats until CC is
 * fully started (IPC connects) or the pane process exits.
 *
 * Also provides pane lifecycle helpers: find pane ID by tab name, check if
 * pane is alive, close tab.
 */

import { execSync } from 'child_process'

const ZELLIJ_SESSION = 'ccmux'

// ---------------------------------------------------------------------------
// Zellij helpers
// ---------------------------------------------------------------------------

function zj(cmd: string): string {
  return execSync(`zellij --session ${ZELLIJ_SESSION} action ${cmd}`, {
    encoding: 'utf8',
    timeout: 5000,
  }).trim()
}

export function listPanes(): any[] {
  try {
    return JSON.parse(zj('list-panes --json'))
  } catch { return [] }
}

export function findPaneByTabName(tabName: string): { paneId: number; exited: boolean; exitStatus: number | null } | null {
  const panes = listPanes()
  for (const p of panes) {
    if (p.tab_name === tabName && !p.is_plugin) {
      return { paneId: p.id, exited: p.exited ?? false, exitStatus: p.exit_status ?? null }
    }
  }
  return null
}

export function dumpScreen(paneId: number): string {
  try {
    return zj(`dump-screen --pane-id ${paneId}`)
  } catch { return '' }
}

/** Async version of dumpScreen — doesn't block event loop */
export async function dumpScreenAsync(paneId: number): Promise<string> {
  try {
    const { exec: execCb } = require('child_process') as typeof import('child_process')
    const { promisify } = require('util') as typeof import('util')
    const exec = promisify(execCb)
    const { stdout } = await exec(
      `zellij --session ${ZELLIJ_SESSION} action dump-screen --pane-id ${paneId}`,
      { encoding: 'utf8', timeout: 5000 },
    )
    return stdout.trim()
  } catch { return '' }
}

const ZELLIJ_KEY_ALIASES: Record<string, string> = { Escape: 'Esc' }

export function sendKeys(paneId: number, ...keys: string[]): void {
  try {
    const normalized = keys.map(k => ZELLIJ_KEY_ALIASES[k] ?? k)
    zj(`send-keys --pane-id ${paneId} ${normalized.join(' ')}`)
  } catch {}
}

/** Write raw bytes to a pane's PTY. More reliable than sendKeys for Ink TUIs. */
export function writeRaw(paneId: number, ...bytes: number[]): void {
  try {
    zj(`write -p ${paneId} ${bytes.join(' ')}`)
  } catch {}
}

export function writeChars(paneId: number, text: string): void {
  try {
    // Escape single quotes for shell
    const escaped = text.replace(/'/g, "'\\''")
    execSync(
      `zellij --session ${ZELLIJ_SESSION} action write-chars --pane-id ${paneId} '${escaped}'`,
      { encoding: 'utf8', timeout: 5000 },
    )
  } catch {}
}

export function closeTab(tabName: string): void {
  try {
    // Find tab ID by name
    const tabs = JSON.parse(zj('list-tabs --json'))
    const tab = tabs.find((t: any) => t.name === tabName)
    if (tab) {
      zj(`close-tab-by-id ${tab.tab_id}`)
    }
  } catch {}
}

export function isPaneAlive(paneId: number): boolean {
  const panes = listPanes()
  const p = panes.find((x: any) => x.id === paneId && !x.is_plugin)
  return p ? !p.exited : false
}

// ---------------------------------------------------------------------------
// Interactive UI detection (inspired by ccgram's terminal_parser.py)
// ---------------------------------------------------------------------------

type DetectedUI = {
  type: 'selection' | 'confirm' | 'input' | 'unknown'
  title: string
  options: string[]          // visible options (for selection UI)
  selectedIndex: number      // currently highlighted option
  screenText: string         // raw screen for context
}

// Patterns for detecting CC interactive UIs
const SELECTION_CURSOR = /[❯›▸►⮞→>]\s+\d+\.\s+(.+)/
const OPTION_LINE = /^\s+\d+\.\s+(.+)/
const CONFIRM_HINT = /Enter to confirm|Esc to cancel|Enter to continue/i
const INPUT_HINT = /Type .+ to|Enter (?:your|a) /i
const PROMPT_END = /^[❯›▸►⮞→>]\s*$/m

export function detectInteractiveUI(screen: string): DetectedUI | null {
  const lines = screen.split('\n')

  // Look for action hints near bottom (most reliable signal)
  const hasConfirmHint = lines.some(l => CONFIRM_HINT.test(l))
  const hasInputHint = lines.some(l => INPUT_HINT.test(l))

  if (!hasConfirmHint && !hasInputHint) return null

  // Extract title: look for a prominent line before the options
  let title = ''
  let options: string[] = []
  let selectedIndex = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Selection cursor (currently highlighted)
    const cursorMatch = line.match(SELECTION_CURSOR)
    if (cursorMatch) {
      selectedIndex = options.length
      options.push(cursorMatch[1].trim())
      continue
    }

    // Numbered option
    const optMatch = line.match(OPTION_LINE)
    if (optMatch) {
      options.push(optMatch[1].trim())
      continue
    }
  }

  // Find title: first non-empty, non-option line that looks like a heading
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (OPTION_LINE.test(trimmed)) continue
    if (SELECTION_CURSOR.test(trimmed)) continue
    if (CONFIRM_HINT.test(trimmed)) continue
    if (trimmed.startsWith('─') || trimmed.startsWith('┌') || trimmed.startsWith('└')) continue
    if (trimmed.length > 10 && trimmed.length < 200) {
      title = trimmed
      break
    }
  }

  if (options.length > 0) {
    return {
      type: 'selection',
      title,
      options,
      selectedIndex: selectedIndex >= 0 ? selectedIndex : 0,
      screenText: screen,
    }
  }

  if (hasConfirmHint) {
    return {
      type: 'confirm',
      title,
      options: ['Confirm', 'Cancel'],
      selectedIndex: 0,
      screenText: screen,
    }
  }

  if (hasInputHint) {
    return {
      type: 'input',
      title,
      options: [],
      selectedIndex: -1,
      screenText: screen,
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Build inline keyboard for detected UI
// ---------------------------------------------------------------------------

export type KeyboardButton = { text: string; data: string }
export type KeyboardRow = KeyboardButton[]

export function buildKeyboard(ui: DetectedUI, paneId: number): KeyboardRow[] {
  const prefix = `esc:${paneId}:`
  const kb: KeyboardRow[] = []

  if (ui.type === 'selection') {
    // Option buttons — each sends Up/Down to navigate then Enter
    for (let i = 0; i < ui.options.length; i++) {
      const label = ui.options[i].slice(0, 40) // truncate for button
      kb.push([{ text: `${i === ui.selectedIndex ? '▸ ' : ''}${i + 1}. ${label}`, data: `${prefix}select:${i}` }])
    }
    // Navigation row
    kb.push([
      { text: '↑', data: `${prefix}key:Up` },
      { text: '↓', data: `${prefix}key:Down` },
      { text: '✓ Enter', data: `${prefix}key:Enter` },
      { text: '✕ Esc', data: `${prefix}key:Escape` },
    ])
  } else if (ui.type === 'confirm') {
    kb.push([
      { text: '✓ Confirm', data: `${prefix}key:Enter` },
      { text: '✕ Cancel', data: `${prefix}key:Escape` },
    ])
  } else {
    // Generic navigation
    kb.push([
      { text: '↑', data: `${prefix}key:Up` },
      { text: '↓', data: `${prefix}key:Down` },
    ])
    kb.push([
      { text: '✕ Esc', data: `${prefix}key:Escape` },
      { text: '🔄', data: `${prefix}refresh` },
      { text: '✓ Enter', data: `${prefix}key:Enter` },
    ])
  }

  return kb
}

// ---------------------------------------------------------------------------
// Handle keyboard callback
// ---------------------------------------------------------------------------

/**
 * Handle escort keyboard callback. For 'select', navigates step-by-step
 * with screen verification between each keystroke. Event-based, not timer-based.
 */
export async function handleEscortCallback(data: string): Promise<void> {
  const parts = data.split(':')
  if (parts[0] !== 'esc' || parts.length < 3) return
  const paneId = parseInt(parts[1])
  const action = parts.slice(2).join(':')

  if (action.startsWith('key:')) {
    sendKeys(paneId, action.slice(4))
  } else if (action.startsWith('select:')) {
    const targetIdx = parseInt(action.slice(7))
    await navigateAndSelect(paneId, targetIdx)
  }
}

/**
 * Navigate to a selection item and confirm. Each step verifies the screen
 * changed before proceeding. No fixed delays — waits for state change.
 */
async function navigateAndSelect(paneId: number, targetIdx: number): Promise<void> {
  // Step 1: go to top (send Ups until cursor is on item 0)
  for (let i = 0; i < 10; i++) {
    const before = dumpScreen(paneId)
    sendKeys(paneId, 'Up')
    if (!await waitForScreenChange(paneId, before)) break  // screen didn't change = at top
  }

  // Step 2: navigate down to target
  for (let i = 0; i < targetIdx; i++) {
    const before = dumpScreen(paneId)
    sendKeys(paneId, 'Down')
    await waitForScreenChange(paneId, before)
  }

  // Step 3: confirm
  const before = dumpScreen(paneId)
  sendKeys(paneId, 'Enter')
  await waitForScreenChange(paneId, before)
}

/**
 * Wait until dump-screen differs from `beforeScreen`, or timeout.
 * Returns true if screen changed, false on timeout.
 */
async function waitForScreenChange(paneId: number, beforeScreen: string, timeoutMs = 3000): Promise<boolean> {
  const start = Date.now()
  const beforeHash = simpleHash(beforeScreen)
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 100))
    const current = dumpScreen(paneId)
    if (simpleHash(current) !== beforeHash) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Escort loop — runs after spawn until IPC connects or pane dies
// ---------------------------------------------------------------------------

export type EscortCallbacks = {
  /** Send a message (with optional inline keyboard) to the originating channel */
  sendToChannel: (text: string, keyboard?: KeyboardRow[]) => Promise<string | undefined>
  /** Update a previously sent message */
  editMessage: (messageId: string, text: string, keyboard?: KeyboardRow[]) => Promise<void>
  /** Check if IPC for this session is connected */
  isIpcConnected: () => boolean
}

export async function runEscort(
  tabName: string,
  callbacks: EscortCallbacks,
): Promise<'connected' | 'exited' | 'timeout'> {
  const POLL_MS = 1500
  const TIMEOUT_MS = 120_000  // 2 minutes max

  // Wait for pane to appear (zellij new-tab is async)
  let pane: ReturnType<typeof findPaneByTabName> = null
  for (let i = 0; i < 20; i++) {
    pane = findPaneByTabName(tabName)
    if (pane) break
    await new Promise(r => setTimeout(r, 500))
  }
  if (!pane) {
    await callbacks.sendToChannel('⚠️ Session pane not found after 10s.')
    return 'exited'
  }

  let lastMessageId: string | undefined
  let lastScreenHash = ''
  const startTime = Date.now()

  while (Date.now() - startTime < TIMEOUT_MS) {
    // Check if IPC connected → escort done
    if (callbacks.isIpcConnected()) {
      if (lastMessageId) {
        await callbacks.editMessage(lastMessageId, '✅ Session ready.').catch(() => {})
      }
      return 'connected'
    }

    // Check if pane is still alive (grace period: don't check first 5s)
    if (Date.now() - startTime > 5000) {
      pane = findPaneByTabName(tabName)
      if (!pane || pane.exited) {
        if (lastMessageId) {
          await callbacks.editMessage(lastMessageId, `❌ Session exited (code ${pane?.exitStatus}).`).catch(() => {})
        }
        return 'exited'
      }
    }

    // Capture screen
    const screen = dumpScreen(pane.paneId)
    const screenHash = simpleHash(screen)

    // Only update if screen changed
    if (screenHash !== lastScreenHash) {
      lastScreenHash = screenHash
      const ui = detectInteractiveUI(screen)

      if (ui) {
        const kb = buildKeyboard(ui, pane.paneId)
        const text = `🔧 *Setup:* ${ui.title || '(interactive prompt)'}\n\n${ui.options.map((o, i) => `${i === ui.selectedIndex ? '▸' : ' '} ${i + 1}. ${o}`).join('\n')}`

        if (lastMessageId) {
          await callbacks.editMessage(lastMessageId, text, kb).catch(() => {})
        } else {
          lastMessageId = await callbacks.sendToChannel(text, kb)
        }
      }
    }

    await new Promise(r => setTimeout(r, POLL_MS))
  }

  return 'timeout'
}

function simpleHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return String(h)
}
