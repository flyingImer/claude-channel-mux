import { mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { test, expect } from 'bun:test'
import { appServerErrorMessage, appServerExitErrorMessage, appServerListenUrlFromLine, appServerMalformedLineMessage, CodexAppServerClient, jsonObject, parseAppServerMessage } from '../agents/codex/app-server-client.ts'
import { codexLaunchArgs, codexLaunchArgsFromEnv } from '../agents/codex/launch-args.ts'
import { redactSensitiveText } from '../redact.ts'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('parseAppServerMessage ignores malformed or non-object JSON-RPC lines', () => {
  expect(parseAppServerMessage('not json')).toBeUndefined()
  expect(parseAppServerMessage('null')).toBeUndefined()
  expect(parseAppServerMessage('[]')).toBeUndefined()
  expect(parseAppServerMessage('"notification"')).toBeUndefined()
})

test('parseAppServerMessage keeps typed object payloads without trusting unknown input', () => {
  const message = parseAppServerMessage('{"id":1,"method":"thread/new","params":{"items":[{"text":"hi"}]}}')
  expect(message).toEqual({ id: 1, method: 'thread/new', params: { items: [{ text: 'hi' }] } })
  expect(typeof message?.id).toBe('number')
  expect(typeof message?.method).toBe('string')
})

test('jsonObject recursively drops non-JSON object members from host objects', () => {
  const message = jsonObject({ id: 1, fn: () => {}, nested: { ok: true, skip: undefined, bad: NaN }, list: [1, undefined, Infinity, { text: 'x' }] })
  expect(message).toEqual({ id: 1, nested: { ok: true }, list: [1, null, null, { text: 'x' }] })
})

test('appServerErrorMessage extracts JSON-RPC error messages with safe fallback', () => {
  expect(appServerErrorMessage({ message: 'denied' })).toBe('denied')
  expect(appServerErrorMessage({ message: { reason: 'denied' } })).toBe('{"reason":"denied"}')
  expect(appServerErrorMessage({ code: -32000, data: { reason: 'bad' } })).toBe('{"code":-32000,"data":{"reason":"bad"}}')
  expect(appServerErrorMessage({ message: 'OPENAI_API_KEY=sk-1234567890abcdef' })).toBe('OPENAI_API_KEY=…redacted')
  expect(appServerErrorMessage('bad')).toBeUndefined()
})


test('appServerExitErrorMessage includes recent stderr without unbounded output', () => {
  expect(appServerExitErrorMessage(1, null, [])).toBe('codex app-server exited (1)')
  expect(appServerExitErrorMessage(1, null, ['warn', 'Missing environment variable: OPENAI_API_KEY'])).toBe('codex app-server exited (1): warn | Missing environment variable: OPENAI_API_KEY')
  expect(appServerExitErrorMessage(null, 'SIGTERM', ['a', 'b', 'c', 'd'])).toBe('codex app-server exited (SIGTERM): b | c | d')
})

test('appServerExitErrorMessage redacts secrets from stderr before user-visible surfacing', () => {
  expect(redactSensitiveText('OPENAI_API_KEY=sk-1234567890abcdef')).toBe('OPENAI_API_KEY=…redacted')
  expect(redactSensitiveText('token: ghp_abcdefghijklmnopqrstuvwxyz')).toBe('token: …redacted')
  expect(redactSensitiveText('secret = hunter2')).toBe('secret = …redacted')
  expect(appServerExitErrorMessage(1, null, ['using sk-1234567890abcdef'])).toBe('codex app-server exited (1): using sk-…redacted')
})


test('appServerMalformedLineMessage redacts and bounds ignored stdout', () => {
  const line = `not-json OPENAI_API_KEY=sk-1234567890abcdef ${'x'.repeat(700)}`
  const message = appServerMalformedLineMessage(line)
  expect(message).toStartWith('codex app-server ignored malformed stdout line: not-json OPENAI_API_KEY=…redacted')
  expect(message).not.toContain('sk-1234567890abcdef')
  expect(message.length).toBeLessThanOrEqual('codex app-server ignored malformed stdout line: '.length + 500)
})

test('appServerListenUrlFromLine extracts loopback websocket listener URL', () => {
  expect(appServerListenUrlFromLine('listening on: ws://127.0.0.1:41821')).toBe('ws://127.0.0.1:41821')
  expect(appServerListenUrlFromLine('[info] listening on: ws://127.0.0.1:41821/abc')).toBe('ws://127.0.0.1:41821/abc')
  expect(appServerListenUrlFromLine('listening on: http://127.0.0.1:41821')).toBeUndefined()
})

test('codexLaunchArgs are driven by environment instead of private defaults', () => {
  expect(codexLaunchArgs()).toEqual([])
  expect(codexLaunchArgsFromEnv({ CCM_CODEX_MODEL: 'custom-model' })).toEqual(['-m', 'custom-model'])
  expect(codexLaunchArgsFromEnv({ CCM_CODEX_MODEL: 'env-model' }, 'room-model')).toEqual(['-m', 'room-model'])
})

test('CodexAppServerClient starts app-server after all config args', async () => {
  const dir = join(tmpdir(), 'ccm-codex-client-argv-' + process.pid + '-' + Date.now())
  mkdirSync(dir, { recursive: true })
  const script = join(dir, 'fake-app-server-argv.js')
  const argvPath = join(dir, 'argv.json')
  await Bun.write(script, [
    "const fs = require('fs')",
    'fs.writeFileSync(' + JSON.stringify(argvPath) + ', JSON.stringify(process.argv.slice(2)))',
    "process.stdin.setEncoding('utf8')",
    "process.stdin.on('data', chunk => {",
    "  for (const line of String(chunk).trim().split(/\\n+/)) {",
    "    if (!line) continue",
    "    const msg = JSON.parse(line)",
    "    if (msg.method === 'initialize') process.stdout.write(JSON.stringify({ id: msg.id, result: {} }) + '\\n')",
    '  }',
    '})',
  ].join('\n'))
  const launchArgs = codexLaunchArgs()
  const client = new CodexAppServerClient({
    codexCommand: [process.execPath, script, ...launchArgs],
    cwd: dir,
    env: process.env,
    configArgs: ['-c', 'mcp_servers.test.command="bun"'],
  })
  try {
    await client.start()
    expect(JSON.parse(readFileSync(argvPath, 'utf8'))).toEqual([...launchArgs, '-c', 'mcp_servers.test.command="bun"', 'app-server', '--listen', 'stdio://'])
  } finally {
    await client.stop().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CodexAppServerClient initializes experimental API capability for thread settings', async () => {
  const dir = join(tmpdir(), 'ccm-codex-client-init-' + process.pid + '-' + Date.now())
  mkdirSync(dir, { recursive: true })
  const script = join(dir, 'fake-app-server-init.js')
  const initPath = join(dir, 'initialize.json')
  await Bun.write(script, [
    "const fs = require('fs')",
    "process.stdin.setEncoding('utf8')",
    "process.stdin.on('data', chunk => {",
    "  for (const line of String(chunk).trim().split(/\\n+/)) {",
    "    if (!line) continue",
    "    const msg = JSON.parse(line)",
    "    if (msg.method === 'initialize') {",
    '      fs.writeFileSync(' + JSON.stringify(initPath) + ', JSON.stringify(msg.params))',
    "      process.stdout.write(JSON.stringify({ id: msg.id, result: {} }) + '\\n')",
    "    }",
    '  }',
    '})',
  ].join('\n'))
  const client = new CodexAppServerClient({
    codexCommand: [process.execPath, script],
    cwd: dir,
    env: process.env,
  })
  try {
    await client.start()
    expect(JSON.parse(readFileSync(initPath, 'utf8'))).toMatchObject({ capabilities: { experimentalApi: true } })
  } finally {
    await client.stop().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CodexAppServerClient.stop terminates spawned app-server children', async () => {
  const dir = join(tmpdir(), `ccm-codex-client-${process.pid}-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  const script = join(dir, 'fake-app-server.js')
  await Bun.write(script, `
    const { spawn } = require('child_process')
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    console.error('CHILD_PID=' + child.pid)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      for (const line of String(chunk).trim().split(/\\n+/)) {
        if (!line) continue
        const msg = JSON.parse(line)
        if (msg.method === 'initialize') process.stdout.write(JSON.stringify({ id: msg.id, result: {} }) + '\\n')
      }
    })
  `)
  let childPid: number | undefined
  const client = new CodexAppServerClient({
    codexCommand: [process.execPath, script],
    cwd: dir,
    env: process.env,
    stderr: line => {
      const match = line.match(/CHILD_PID=(\d+)/)
      if (match) childPid = Number(match[1])
    },
  })
  try {
    await client.start()
    expect(childPid).toBeNumber()
    expect(processExists(childPid!)).toBe(true)
    await client.stop()
    for (let i = 0; i < 20 && processExists(childPid!); i++) await sleep(50)
    expect(processExists(childPid!)).toBe(false)
  } finally {
    if (childPid && processExists(childPid)) {
      try { process.kill(childPid, 'SIGKILL') } catch {}
    }
    await client.stop().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
})
