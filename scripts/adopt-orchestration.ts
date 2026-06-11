import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

const usage = `Usage:
  bun scripts/adopt-orchestration.ts <initiative-id> [--root <dir>] [--repair]

Validates an existing Git-backed CCM orchestration initiative. With --repair, creates missing required directories only; it never overwrites required files.
`

const requiredFiles = ['intake.md', 'stage.md', 'workers.md', 'state.md']
const requiredDirs = ['inbox', 'recall', 'decisions', 'reports', 'source-material']

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

const args = process.argv.slice(2)
const initiativeId = args.find((arg) => !arg.startsWith('--'))
if (!initiativeId) fail('initiative id is required')
const root = optionValue(args, '--root') ?? 'docs/orchestration'
const repair = args.includes('--repair')
const initiativeDir = join(root, initiativeId)
if (!existsSync(initiativeDir)) fail(`${initiativeDir} does not exist`)

const missingFiles = requiredFiles.filter((file) => !existsSync(join(initiativeDir, file)))
if (missingFiles.length) fail(`missing required files: ${missingFiles.join(', ')}`)

const missingDirs = requiredDirs.filter((dir) => !existsSync(join(initiativeDir, dir)))
if (missingDirs.length && !repair) fail(`missing required directories: ${missingDirs.join(', ')}; pass --repair to create them`)
for (const dir of missingDirs) mkdirSync(join(initiativeDir, dir), { recursive: true })

console.log(`adopted ${initiativeDir}`)
if (missingDirs.length) console.log(`created directories: ${missingDirs.join(', ')}`)
