const CLAUDE_NAV_SCREEN_LINE_LIMIT = 80
const CLAUDE_NAV_MESSAGE_CHAR_LIMIT = 3500
const CLAUDE_TASK_LIST_FOOTER_RE = /\b(?:↑\/↓ to select|Enter to view|ctrl\+t to hide tasks|↓ to manage)\b/i
const PROMPT_HINT_RE = /(?<![+\w])(?:Esc|Enter|Tab|Space|Ctrl\+[A-Z]|[↑↓←→]+\/[↑↓←→]+) to [a-z]/

export function truncateClaudeNavScreen(text: string, maxChars = CLAUDE_NAV_MESSAGE_CHAR_LIMIT): string {
  const lines = text.split('\n')
  let kept = lines
  let omitted = 0
  if (kept.length > CLAUDE_NAV_SCREEN_LINE_LIMIT) {
    omitted = kept.length - CLAUDE_NAV_SCREEN_LINE_LIMIT
    kept = kept.slice(-CLAUDE_NAV_SCREEN_LINE_LIMIT)
  }
  while (kept.length > 1 && [`… truncated ${omitted} earlier lines …`, ...kept].join('\n').length > maxChars) {
    kept = kept.slice(1)
    omitted++
  }
  const rendered = omitted > 0 ? [`… truncated ${omitted} earlier lines …`, ...kept].join('\n') : kept.join('\n')
  if (rendered.length <= maxChars) return rendered
  return `… truncated ${Math.max(0, text.length - maxChars)} earlier chars …\n${rendered.slice(-maxChars)}`.slice(-maxChars)
}

export function isClaudeDialogScreen(screen: string, permissionInFlight = false): boolean {
  if (permissionInFlight) return false
  if (CLAUDE_TASK_LIST_FOOTER_RE.test(screen)) return false
  return PROMPT_HINT_RE.test(screen)
}

export function claudeNavMessageText(uuidShort: string, screen: string): string {
  const lines = screen.split('\n')
  const prefix = `🔧 Claude nav \`${uuidShort}\`:\n\`\`\`\n`
  const suffix = '\n```'
  const clean = truncateClaudeNavScreen(lines.filter(l => l.trim()).join('\n').trim(), CLAUDE_NAV_MESSAGE_CHAR_LIMIT - prefix.length - suffix.length)
  return `${prefix}${clean}${suffix}`
}
