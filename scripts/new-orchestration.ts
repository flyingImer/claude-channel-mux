import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { join } from 'path'

const usage = `Usage:
  bun scripts/new-orchestration.ts <initiative-id> --from <actor> --source-ref <ref> --coordination-branch <branch> [--title <stage>] [--target-base <branch-or-sha>] [--orchestrator-session <id>] [--remote <url-or-policy-ref>] [--branch-policy <policy>] [--push-policy <policy>] [--validation-gate <command>] [--root <dir>] [--body-file <path>] [--force]

Creates a Git-backed CCM orchestration initiative from docs/orchestration/_templates.
`

type Options = {
  initiativeId: string
  from: string
  sourceRef: string
  title: string
  coordinationBranch: string
  targetBase: string
  orchestratorSession: string
  remote: string
  branchPolicy: string
  pushPolicy: string
  validationGate: string
  root: string
  bodyFile?: string
  force: boolean
}

const requiredDirs = ['inbox', 'recall', 'decisions', 'reports', 'source-material', 'conflicts']
const requiredFiles = ['intake.md', 'stage.md', 'workers.md', 'state.md']
const rootHarnessFiles = ['AGENTS.md', 'state-machine.md']
const rootHarnessTemplateFiles = [
  'intake.md',
  'stage.md',
  'workers.md',
  'state.md',
  'inbox-item.md',
  'recall-packet.md',
  'guiding-principal-response.md',
  'gp-packet.md',
  'conflict.md',
  'worker-report.md',
  'audit-report.md',
  'recovery-note.md',
  'repo-policy.md',
]

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

function initiativeIdValue(args: string[]): string {
  const value = args.find((arg) => !arg.startsWith('--'))
  if (!value) fail('initiative id is required')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) fail('initiative id must use letters, numbers, dot, underscore, or dash')
  return value
}

function parseOptions(): Options {
  const args = process.argv.slice(2)
  const from = optionValue(args, '--from')
  if (!from) fail('--from is required')
  const sourceRef = optionValue(args, '--source-ref')
  if (!sourceRef) fail('--source-ref is required')
  const coordinationBranch = optionValue(args, '--coordination-branch')
  if (!coordinationBranch) fail('--coordination-branch is required; do not silently assume main')
  return {
    initiativeId: initiativeIdValue(args),
    from,
    sourceRef,
    title: optionValue(args, '--title') ?? 'initial-stage',
    coordinationBranch,
    targetBase: optionValue(args, '--target-base') ?? '<branch-or-sha>',
    orchestratorSession: optionValue(args, '--orchestrator-session') ?? '<diagnostic only; not a lock>',
    remote: optionValue(args, '--remote') ?? '<remote-url-or-policy-ref>',
    branchPolicy: optionValue(args, '--branch-policy') ?? '<coordination branch, review, protection, or direct-commit rule>',
    pushPolicy: optionValue(args, '--push-policy') ?? '<author, account, approval, or push transport requirements>',
    validationGate: optionValue(args, '--validation-gate') ?? 'bun run validate',
    root: optionValue(args, '--root') ?? 'docs/orchestration',
    bodyFile: optionValue(args, '--body-file'),
    force: args.includes('--force'),
  }
}

function readBody(bodyFile?: string): string {
  if (!bodyFile) return '<durable human or Guiding Principal intent>'
  const body = readFileSync(bodyFile, 'utf8').trim()
  if (!body) fail('--body-file is empty')
  return body
}

function writeNew(path: string, content: string, force: boolean) {
  if (existsSync(path) && !force) fail(`${path} already exists; pass --force to overwrite`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function writeNewOrSame(path: string, content: string, force: boolean) {
  if (existsSync(path) && !force && readFileSync(path, 'utf8') === content) return
  writeNew(path, content, force)
}

function template(name: string): string {
  return readFileSync(join('docs/orchestration/_templates', name), 'utf8')
}

const options = parseOptions()
const body = readBody(options.bodyFile)
const initiativeDir = join(options.root, options.initiativeId)
mkdirSync(options.root, { recursive: true })
for (const file of rootHarnessFiles) {
  writeNewOrSame(join(options.root, file), readFileSync(join('docs/orchestration', file), 'utf8'), options.force)
}
for (const file of rootHarnessTemplateFiles) {
  writeNewOrSame(join(options.root, '_templates', file), template(file), options.force)
}
mkdirSync(initiativeDir, { recursive: true })
for (const dir of requiredDirs) mkdirSync(join(initiativeDir, dir), { recursive: true })

writeNew(join(initiativeDir, 'intake.md'), template('intake.md')
  .replaceAll('<initiative-id>', options.initiativeId)
  .replace('<iso timestamp>', new Date().toISOString())
  .replace('<orchestrator / guiding principal / human>', options.from)
  .replace('<chat/thread/doc/link/transcript ref>', options.sourceRef)
  .replace('<durable human or Guiding Principal intent>', body), options.force)

writeNew(join(initiativeDir, 'stage.md'), template('stage.md')
  .replace('<stage-name>', options.title), options.force)

writeNew(join(initiativeDir, 'workers.md'), template('workers.md'), options.force)

writeNew(join(initiativeDir, 'state.md'), template('state.md')
  .replace('<initiative-id>', options.initiativeId)
  .replace('<branch>', options.coordinationBranch)
  .replace('<branch-or-sha>', options.targetBase)
  .replace('<diagnostic only; not a lock>', options.orchestratorSession)
  .replace('<stage-name>', options.title)
  .replace('<remote-url-or-policy-ref>', options.remote)
  .replace('<coordination branch, review, protection, or direct-commit rule>', options.branchPolicy)
  .replace('<author, account, approval, or push transport requirements>', options.pushPolicy)
  .replace('<repo validation command>', options.validationGate), options.force)

writeNew(join(initiativeDir, 'decisions', 'repo-policy.md'), template('repo-policy.md')
  .replace('<remote-url-or-policy-ref>', options.remote)
  .replace('<branch>', options.coordinationBranch)
  .replace('<branch-or-sha>', options.targetBase)
  .replace('<author policy>', options.pushPolicy)
  .replace('<push policy>', options.pushPolicy)
  .replace('<command>', options.validationGate), options.force)

console.log(`created ${initiativeDir}`)
for (const file of requiredFiles) console.log(join(initiativeDir, file))
for (const dir of requiredDirs) console.log(join(initiativeDir, dir))
