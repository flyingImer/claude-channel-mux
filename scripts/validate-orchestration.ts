import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const usage = `Usage:
  bun scripts/validate-orchestration.ts [--root <dir>] [--ready]
`

function fail(message: string): never {
  console.error(`orchestration validation failed: ${message}\n\n${usage}`)
  process.exit(1)
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) fail(`missing value for ${name}`)
  return value
}

const args = process.argv.slice(2)
const root = optionValue(args, '--root') ?? 'docs/orchestration'
const ready = args.includes('--ready')
const templatesDir = join(root, '_templates')

const requiredTemplates = [
  'intake.md',
  'stage.md',
  'workers.md',
  'state.md',
  'inbox-item.md',
  'recall-packet.md',
  'guiding-principal-response.md',
  'worker-report.md',
  'audit-report.md',
  'recovery-note.md',
]

const requiredInitiativeEntries = [
  'intake.md',
  'stage.md',
  'workers.md',
  'state.md',
  'inbox',
  'recall',
  'decisions',
  'reports',
  'source-material',
]

const requiredInitiativeFileText: Record<string, string[]> = {
  'intake.md': ['# Durable Intake:', '## Source', 'Source Reference:', '## Intent'],
  'stage.md': ['# Stage Contract:', '## Objective', '## Acceptance Evidence', '## Audit Requirement'],
  'workers.md': ['Worker Task ID', 'desired_room_name', 'State Vocabulary'],
  'state.md': ['# Orchestration State', 'Coordination Branch:', 'Active Orchestrator Session:', '## Source Of Truth Order'],
  'decisions/repo-policy.md': ['# Decision: Repo Policy', 'Coordination Branch:', 'Push Transport / Account:', 'Validation Gate:'],
}

const readyPlaceholderPatterns = [
  /<[^>]+>/,
  /`<[^`]+>`/,
]

const requiredTemplateText: Record<string, string[]> = {
  'stage.md': ['# Stage Contract:', '## Objective', '## Acceptance Evidence', '## Audit Requirement'],
  'inbox-item.md': ['# Inbox Item:', 'Source Reference:', 'Status: unread', '## Claimed Impact'],
  'recall-packet.md': ['# Recall Packet:', '## Question', 'Intake/Stage Refs:', 'Decisions/Inboxes:', 'Worker Evidence:', '## Repo Evidence Summary', '## Requested Answer Format'],
  'workers.md': ['worker_task_id', 'desired_room_name', 'unsupported_capability'],
  'state.md': ['# Orchestration State', '## Source Of Truth Order', 'Raw chat only after persisted with attribution'],
  'worker-report.md': ['# Worker Report:', '## Verification', '## Next Step'],
  'audit-report.md': ['# Audit Report:', '## Blocking', '## Recommended Orchestrator Action'],
  'guiding-principal-response.md': ['# Guiding Principal Response:', '## Decision Or Framing', '## Orchestrator Sanity Check'],
  'recovery-note.md': ['# Recovery Note:', '## External Facts', '## Next Action'],
}

function assertExists(path: string) {
  if (!existsSync(path)) fail(`missing ${path}`)
}

assertExists(root)
assertExists(join(root, 'AGENTS.md'))
assertExists(join(root, 'state-machine.md'))
assertExists(templatesDir)

const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8')
for (const required of ['durable orchestration truth', 'Minimal Effective Path', 'smallest durable set', 'Workers must not edit orchestration bookkeeping', 'Guiding Principal responses provide human-context judgment', 'unsupported_capability']) {
  if (!agents.includes(required)) fail(`${join(root, 'AGENTS.md')} missing ${required}`)
}

const stateMachine = readFileSync(join(root, 'state-machine.md'), 'utf8')
for (const required of ['room_intent_recorded', 'attention_needed', 'archive_failed', 'unsupported_capability', 'Do not request archive before']) {
  if (!stateMachine.includes(required)) fail(`${join(root, 'state-machine.md')} missing ${required}`)
}

for (const template of requiredTemplates) {
  const path = join(templatesDir, template)
  assertExists(path)
  const body = readFileSync(path, 'utf8')
  for (const required of requiredTemplateText[template] ?? []) {
    if (!body.includes(required)) fail(`${path} missing ${required}`)
  }
}

const entries = readdirSync(root)
for (const entry of entries) {
  if (entry === '_templates' || entry === 'AGENTS.md' || entry === 'state-machine.md') continue
  const path = join(root, entry)
  if (!statSync(path).isDirectory()) continue
  for (const required of requiredInitiativeEntries) {
    assertExists(join(path, required))
  }
  for (const [file, requiredTexts] of Object.entries(requiredInitiativeFileText)) {
    const body = readFileSync(join(path, file), 'utf8')
    for (const required of requiredTexts) {
      if (!body.includes(required)) fail(`${join(path, file)} missing ${required}`)
    }
    if (ready) {
      for (const pattern of readyPlaceholderPatterns) {
        if (pattern.test(body)) fail(`${join(path, file)} contains unresolved placeholder text`)
      }
    }
  }
}

console.log('orchestration validation passed')
