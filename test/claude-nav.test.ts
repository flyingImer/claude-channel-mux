import { test, expect } from 'bun:test'
import { claudeNavMessageText, isClaudeDialogScreen } from '../claude-nav.ts'

test('Claude subagent task list footer is not treated as an actionable nav dialog', () => {
  const screen = `● Delegating edits to worker subagent… (17m 12s · ↓ 64.9k tokens)
  ⎿  ✔ Phase 1: Read-only audit (delegated)
     ◼ Phase 2: Worker subagent applies edits

  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ctrl+t to hide tasks · ↓ to manage

  ● main                                                                 ↑/↓ to select · Enter to view
  ◯ general-purpose  Diagnose external write scope                      1m 4s`

  expect(isClaudeDialogScreen(screen)).toBe(false)
})

test('Claude confirmation prompts still trigger nav dialogs', () => {
  expect(isClaudeDialogScreen(`Allow command?
  1. Yes
❯ 2. No
Enter to confirm`)).toBe(true)
})

test('Claude selection prompts with task-list-like key hints still trigger nav dialogs', () => {
  const screen = `  Resume conversation

  ❯ 1. 1f0012eb-c6b1-42cd-bef3-01e5ccc5e27b  /home/repo/ejwang/ws-spi-r8
    2. Start new conversation

  ↑/↓ to select · Enter to view · Esc to cancel`

  expect(isClaudeDialogScreen(screen)).toBe(true)
})

test('Claude nav message text is bounded below channel edit limits', () => {
  const longScreen = Array.from({ length: 120 }, (_, index) => `line ${index} ${'x'.repeat(140)}`).join('\n')

  expect(claudeNavMessageText('session1', longScreen).length).toBeLessThanOrEqual(3500)
})
