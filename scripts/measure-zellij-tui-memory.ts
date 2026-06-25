#!/usr/bin/env bun
import { findZellijServerProcess, findZellijSessionLine, zellijListSessionsNoFormatting } from '../zellij.js'

type Args = {
  shared: string
  sessions: string[]
  prefix?: string
  maxPerSessionRssKb?: number
  maxPerSessionAnonKb?: number
  requirePerSession?: boolean
}

type Row = {
  session: string
  topology: 'shared' | 'per-session'
  alive: boolean
  pid: number | 'unknown'
  rss_kb: number | 'unknown'
  rss_anon_kb: number | 'unknown'
  vm_data_kb: number | 'unknown'
}

function usage(): never {
  console.error([
    'Usage: bun scripts/measure-zellij-tui-memory.ts [--shared ccmux] (--sessions <name...> | --prefix <prefix>) [gate options]',
    '',
    'Gate options:',
    '  --max-per-session-rss-kb <kb>   exit 1 if any per-session zellij server exceeds this VmRSS',
    '  --max-per-session-anon-kb <kb>  exit 1 if any per-session zellij server exceeds this RssAnon',
    '  --require-per-session           exit 1 if no live per-session rows are found',
  ].join('\n'))
  process.exit(2)
}

function positiveInteger(value: string | undefined, flag: string): number {
  if (!value || !/^\d+$/.test(value)) {
    console.error(`${flag} requires a positive integer value`)
    process.exit(2)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    console.error(`${flag} requires a positive integer value`)
    process.exit(2)
  }
  return parsed
}

function parseArgs(argv: string[]): Args {
  const args: Args = { shared: 'ccmux', sessions: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--shared') {
      args.shared = argv[++i]
      if (!args.shared) usage()
    } else if (arg === '--sessions') {
      i += 1
      while (i < argv.length && !argv[i].startsWith('--')) args.sessions.push(argv[i++])
      i -= 1
    } else if (arg === '--prefix') {
      args.prefix = argv[++i]
      if (!args.prefix) usage()
    } else if (arg === '--max-per-session-rss-kb') {
      args.maxPerSessionRssKb = positiveInteger(argv[++i], arg)
    } else if (arg === '--max-per-session-anon-kb') {
      args.maxPerSessionAnonKb = positiveInteger(argv[++i], arg)
    } else if (arg === '--require-per-session') {
      args.requirePerSession = true
    } else {
      usage()
    }
  }
  if ((args.sessions.length > 0) === !!args.prefix) usage()
  return args
}

function sessionsByPrefix(prefix: string): string[] {
  const output = zellijListSessionsNoFormatting()
  return output
    .split('\n')
    .map(line => line.trim().split(/\s+/)[0])
    .filter(name => name.startsWith(prefix))
}

function value(value: number | undefined): number | 'unknown' {
  return value ?? 'unknown'
}

function numberValue(value: number | 'unknown'): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function sum(values: Array<number | undefined>): number | 'unknown' {
  const known = values.filter((item): item is number => item !== undefined)
  return known.length ? known.reduce((total, item) => total + item, 0) : 'unknown'
}

function rowFor(sessionName: string, topology: Row['topology'], listOutput: string): Row {
  const line = findZellijSessionLine(listOutput, sessionName)
  const alive = !!line && !line.includes('EXITED')
  const memory = alive ? findZellijServerProcess(sessionName) : undefined
  return {
    session: sessionName,
    topology,
    alive,
    pid: memory?.pid ?? 'unknown',
    rss_kb: value(memory?.vmRssKb),
    rss_anon_kb: value(memory?.rssAnonKb),
    vm_data_kb: value(memory?.vmDataKb),
  }
}

function gateFailures(rows: Row[], args: Args): string[] {
  const failures: string[] = []
  const perSessionRows = rows.filter(row => row.topology === 'per-session' && row.alive)
  if (args.requirePerSession && perSessionRows.length === 0) failures.push('no live per-session zellij rows found')
  for (const row of perSessionRows) {
    if (args.maxPerSessionRssKb !== undefined && typeof row.rss_kb === 'number' && row.rss_kb > args.maxPerSessionRssKb) {
      failures.push(`${row.session} rss_kb ${row.rss_kb} > ${args.maxPerSessionRssKb}`)
    }
    if (args.maxPerSessionAnonKb !== undefined && typeof row.rss_anon_kb === 'number' && row.rss_anon_kb > args.maxPerSessionAnonKb) {
      failures.push(`${row.session} rss_anon_kb ${row.rss_anon_kb} > ${args.maxPerSessionAnonKb}`)
    }
  }
  return failures
}

const args = parseArgs(process.argv.slice(2))
const perSessionNames = args.prefix ? sessionsByPrefix(args.prefix) : args.sessions
const sessionNames = Array.from(new Set([args.shared, ...perSessionNames]))
const listOutput = zellijListSessionsNoFormatting()
const rows = sessionNames.map(sessionName => rowFor(sessionName, sessionName === args.shared ? 'shared' : 'per-session', listOutput))
const perSessionRows = rows.filter(row => row.topology === 'per-session')
const failures = gateFailures(rows, args)

console.log(JSON.stringify({
  captured_at: new Date().toISOString(),
  shared_session: args.shared,
  per_session_count: perSessionRows.filter(row => row.alive).length,
  aggregate: {
    shared_rss_kb: rows.find(row => row.topology === 'shared')?.rss_kb ?? 'unknown',
    per_session_total_rss_kb: sum(perSessionRows.map(row => numberValue(row.rss_kb))),
    per_session_total_rss_anon_kb: sum(perSessionRows.map(row => numberValue(row.rss_anon_kb))),
  },
  gate: {
    pass: failures.length === 0,
    failures,
    max_per_session_rss_kb: args.maxPerSessionRssKb ?? null,
    max_per_session_anon_kb: args.maxPerSessionAnonKb ?? null,
    require_per_session: args.requirePerSession ?? false,
  },
  rows,
}, null, 2))

if (failures.length > 0) process.exit(1)
