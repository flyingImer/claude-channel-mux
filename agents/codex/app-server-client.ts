import { redactSensitiveText } from '../../redact.js'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createInterface, type Interface } from 'readline'

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json | undefined }

export function jsonObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const result: JsonObject = {}
  for (const [key, item] of Object.entries(value)) {
    const json = jsonValue(item)
    if (json !== undefined) result[key] = json
  }
  return result
}

function jsonValue(value: unknown): Json | undefined {
  if (value === null) return null
  if (typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (Array.isArray(value)) return value.map(item => jsonValue(item) ?? null)
  return jsonObject(value)
}

export function parseAppServerMessage(line: string): JsonObject | undefined {
  let parsed: unknown
  try { parsed = JSON.parse(line) } catch { return undefined }
  return jsonObject(parsed)
}

export function appServerErrorMessage(error: unknown): string | undefined {
  const object = jsonObject(error)
  if (!object) return undefined
  const message = object.message
  const raw = message === undefined ? JSON.stringify(object) : typeof message === 'string' ? message : JSON.stringify(message)
  return redactSensitiveText(raw)
}

export function appServerExitErrorMessage(code: number | null, signal: NodeJS.Signals | null, stderrLines: string[]): string {
  const status = code ?? signal ?? 'unknown'
  const tail = stderrLines.map(line => redactSensitiveText(line.trim())).filter(Boolean).slice(-3).join(' | ')
  return tail ? `codex app-server exited (${status}): ${tail}` : `codex app-server exited (${status})`
}

export function appServerMalformedLineMessage(line: string): string {
  return `codex app-server ignored malformed stdout line: ${redactSensitiveText(line).slice(0, 500)}`
}

export function appServerListenUrlFromLine(line: string): string | undefined {
  const match = line.match(/\blistening on:\s*(ws:\/\/127\.0\.0\.1:\d+\S*)/i)
  return match?.[1]
}

type Pending = {
  resolve: (value: JsonObject) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

export type CodexAppServerClientOptions = {
  codexBin: string
  cwd: string
  env: Record<string, string | undefined>
  listen?: 'stdio' | 'websocket'
  configArgs?: string[]
  stderr?: (line: string) => void
  notification?: (message: JsonObject) => void
  serverRequest?: (message: JsonObject) => void
}

export class CodexAppServerClient {
  private proc?: ChildProcessWithoutNullStreams
  private rl?: Interface
  private ws?: WebSocket
  private nextId = 1
  private pending = new Map<number, Pending>()
  private stderrLines: string[] = []
  private appServerUrl?: string

  constructor(private opts: CodexAppServerClientOptions) {}

  private rejectPending(err: Error): void {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const item of pending) {
      clearTimeout(item.timer)
      item.reject(err)
    }
  }

  async start(): Promise<void> {
    if (this.proc) return
    const listen = this.opts.listen ?? 'stdio'
    const args = ['app-server', '--listen', listen === 'websocket' ? 'ws://127.0.0.1:0' : 'stdio://', ...(this.opts.configArgs ?? [])]
    this.proc = spawn(this.opts.codexBin, args, {
      cwd: this.opts.cwd,
      env: this.opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.proc.stderr.setEncoding('utf8')
    this.proc.stderr.on('data', chunk => {
      for (const line of String(chunk).split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        this.stderrLines.push(trimmed)
        if (this.stderrLines.length > 10) this.stderrLines.splice(0, this.stderrLines.length - 10)
        const url = appServerListenUrlFromLine(trimmed)
        if (url) this.appServerUrl = url
        this.opts.stderr?.(trimmed)
      }
    })
    this.proc.on('exit', (code, signal) => {
      this.rejectPending(new Error(appServerExitErrorMessage(code, signal, this.stderrLines)))
      this.proc = undefined
    })
    if (listen === 'websocket') {
      this.proc.stdout.setEncoding('utf8')
      this.proc.stdout.on('data', chunk => {
        for (const line of String(chunk).split('\n')) {
          const trimmed = line.trim()
          if (!trimmed) continue
          const url = appServerListenUrlFromLine(trimmed)
          if (url) this.appServerUrl = url
          else this.opts.stderr?.(trimmed)
        }
      })
      await this.connectWebSocket()
    } else {
      this.rl = createInterface({ input: this.proc.stdout })
      this.rl.on('line', line => this.handleLine(line))
      this.appServerUrl = 'stdio://'
    }
    await this.request('initialize', {
      clientInfo: { name: 'claude-channel-mux', version: '0.3.0' },
      capabilities: {
        optOutNotificationMethods: [
          'turn/diff/updated',
          'mcpServer/startupStatus/updated',
        ],
      },
    })
    this.notify('initialized', {})
  }

  url(): string | undefined {
    return this.appServerUrl
  }

  async stop(): Promise<void> {
    const proc = this.proc
    this.proc = undefined
    this.rl?.close()
    this.rl = undefined
    const ws = this.ws
    this.ws = undefined
    this.rejectPending(new Error('codex app-server stopped'))
    try { ws?.close() } catch (err) { this.opts.stderr?.(`codex app-server websocket close failed: ${redactSensitiveText(err instanceof Error ? err.message : String(err))}`) }
    if (!proc) return
    proc.kill('SIGTERM')
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL')
        } catch (err) {
          this.opts.stderr?.(`codex app-server SIGKILL failed: ${redactSensitiveText(err instanceof Error ? err.message : String(err))}`)
        }
        resolve()
      }, 3000)
      proc.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }

  request(method: string, params: JsonObject | undefined, timeoutMs = 60_000): Promise<JsonObject> {
    if (!this.proc?.stdin.writable) return Promise.reject(new Error('codex app-server is not running'))
    const id = this.nextId++
    const payload: JsonObject = params === undefined ? { id, method } : { id, method, params }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      const writeErr = this.write(payload, method)
      if (writeErr) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(writeErr)
      }
    })
  }

  notify(method: string, params: JsonObject | undefined): void {
    this.write(params === undefined ? { method } : { method, params }, `notification ${method}`)
  }

  respond(id: number, result?: JsonObject, error?: JsonObject): void {
    this.write(error ? { id, error } : { id, result: result ?? {} }, `response ${id}`)
  }

  private write(payload: JsonObject, context: string): Error | undefined {
    if (this.ws) {
      if (this.ws.readyState !== WebSocket.OPEN) {
        const err = new Error(`codex app-server write skipped for ${context}: websocket is not open`)
        this.opts.stderr?.(err.message)
        return err
      }
      try {
        this.ws.send(JSON.stringify(payload))
        return undefined
      } catch (err) {
        const message = `codex app-server websocket write failed for ${context}: ${redactSensitiveText(err instanceof Error ? err.message : String(err))}`
        this.opts.stderr?.(message)
        return new Error(message)
      }
    }
    const proc = this.proc
    if (!proc?.stdin.writable) {
      const err = new Error(`codex app-server write skipped for ${context}: process is not running`)
      this.opts.stderr?.(err.message)
      return err
    }
    try {
      proc.stdin.write(JSON.stringify(payload) + '\n', err => {
        if (err) this.opts.stderr?.(`codex app-server write failed for ${context}: ${redactSensitiveText(err.message)}`)
      })
      return undefined
    } catch (err) {
      const message = `codex app-server write failed for ${context}: ${redactSensitiveText(err instanceof Error ? err.message : String(err))}`
      this.opts.stderr?.(message)
      return new Error(message)
    }
  }

  private handleLine(line: string): void {
    const msg = parseAppServerMessage(line)
    if (!msg) {
      this.opts.stderr?.(appServerMalformedLineMessage(line))
      return
    }
    if (typeof msg.id === 'number' && typeof msg.method === 'string') {
      this.opts.serverRequest?.(msg)
      return
    }
    if (typeof msg.id === 'number') {
      const pending = this.pending.get(msg.id)
      if (pending) {
        this.pending.delete(msg.id)
        clearTimeout(pending.timer)
        const errorMessage = appServerErrorMessage(msg.error)
        if (errorMessage) pending.reject(new Error(errorMessage))
        else pending.resolve(msg)
      }
      return
    }
    this.opts.notification?.(msg)
  }

  private async connectWebSocket(): Promise<void> {
    const deadline = Date.now() + 15_000
    while (!this.appServerUrl && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50))
    if (!this.appServerUrl) throw new Error(appServerExitErrorMessage(null, null, [...this.stderrLines, 'codex app-server did not report a websocket listening URL']))
    const ws = new WebSocket(this.appServerUrl)
    this.ws = ws
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`codex app-server websocket connect timed out: ${this.appServerUrl}`)), 15_000)
      ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`codex app-server websocket connect failed: ${this.appServerUrl}`)) }, { once: true })
    })
    ws.addEventListener('message', event => this.handleLine(String(event.data)))
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return
      this.ws = undefined
      this.rejectPending(new Error('codex app-server websocket closed'))
    })
  }
}
