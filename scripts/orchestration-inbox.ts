import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const usage = `Usage:
  bun scripts/orchestration-inbox.ts <initiative-id> --kind intake|inbox --from <actor> --source-ref <ref> [--title <title>] [--at <iso>] [--root <dir>] [--body-file <path>] [--force]

Reads body text from --body-file or stdin. Creates attributed Durable Intake or process-time inbox supplements for Guiding Principal / human context.
`

type Options = {
  initiativeId: string
  kind: 'intake' | 'inbox'
  from: string
  sourceRef: string
  title: string
  at: string
  root: string
  bodyFile?: string
  force: boolean
}

function fail(message: string): never {
  console.error(`${message}\n\n${usage}`)
  process.exit(1)
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) fail(`missing value for ${name}`)
  return value
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug || 'context'
}

function readBody(bodyFile?: string): string {
  const body = bodyFile ? readFileSync(bodyFile, 'utf8') : readFileSync(0, 'utf8')
  const trimmed = body.trim()
  if (!trimmed) fail('body text is required from --body-file or stdin')
  return trimmed
}

function parseOptions(): Options {
  const args = process.argv.slice(2)
  const initiativeId = args.find((arg) => !arg.startsWith('--'))
  if (!initiativeId) fail('initiative id is required')
  const kind = optionValue(args, '--kind')
  if (kind !== 'intake' && kind !== 'inbox') fail('--kind must be intake or inbox')
  const from = optionValue(args, '--from')
  if (!from) fail('--from is required')
  const sourceRef = optionValue(args, '--source-ref')
  if (!sourceRef) fail('--source-ref is required')
  return {
    initiativeId,
    kind,
    from,
    sourceRef,
    title: optionValue(args, '--title') ?? kind,
    at: optionValue(args, '--at') ?? new Date().toISOString(),
    root: optionValue(args, '--root') ?? 'docs/orchestration',
    bodyFile: optionValue(args, '--body-file'),
    force: args.includes('--force'),
  }
}

function nextInboxPath(inboxDir: string, at: string, title: string): string {
  const date = at.slice(0, 10)
  const slug = slugify(title)
  for (let index = 1; index < 1000; index += 1) {
    const candidate = join(inboxDir, `${date}-${String(index).padStart(3, '0')}-${slug}.md`)
    if (!existsSync(candidate) && !existsSync(`${candidate}.done`)) return candidate
  }
  fail(`no available inbox sequence for ${date}`)
}

function ensureInitiativeDirs(initiativeDir: string) {
  for (const dir of ['', 'inbox', 'recall', 'decisions', 'reports', 'source-material']) {
    mkdirSync(join(initiativeDir, dir), { recursive: true })
  }
}

const options = parseOptions()
const body = readBody(options.bodyFile)
const initiativeDir = join(options.root, options.initiativeId)
ensureInitiativeDirs(initiativeDir)

if (options.kind === 'intake') {
  const path = join(initiativeDir, 'intake.md')
  if (existsSync(path) && !options.force) fail(`${path} already exists; pass --force to overwrite`)
  writeFileSync(path, `# Durable Intake: ${options.initiativeId}\n\n## Source\n\n- Captured At: ${options.at}\n- Captured By: ${options.from}\n- Source Reference: ${options.sourceRef}\n\n## Intent\n\n${body}\n\n## Constraints\n\n- <repo policy, platform limit, deadline, non-goal>\n\n## Initial Questions\n\n- <open clarification or none>\n`)
  console.log(path)
} else {
  const path = nextInboxPath(join(initiativeDir, 'inbox'), options.at, options.title)
  writeFileSync(path, `# Inbox Item: ${options.title}\n\n- Received At: ${options.at}\n- From: ${options.from}\n- Source Reference: ${options.sourceRef}\n- Status: unread\n\n## Content\n\n${body}\n\n## Claimed Impact\n\n<stage change, worker conflict, priority change, representation guidance, or none>\n`)
  console.log(path)
}
