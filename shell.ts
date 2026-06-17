export function shellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function shellWords(value: string): string[] {
  const words: string[] = []
  let current = ''
  let quote: 'single' | 'double' | undefined
  let escaping = false

  for (const ch of value) {
    if (escaping) {
      current += ch
      escaping = false
      continue
    }
    if (ch === '\\' && quote !== 'single') {
      escaping = true
      continue
    }
    if (quote === 'single') {
      if (ch === "'") quote = undefined
      else current += ch
      continue
    }
    if (quote === 'double') {
      if (ch === '"') quote = undefined
      else current += ch
      continue
    }
    if (ch === "'") {
      quote = 'single'
      continue
    }
    if (ch === '"') {
      quote = 'double'
      continue
    }
    if (/\s/.test(ch)) {
      if (current) {
        words.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }

  if (escaping) current += '\\'
  if (current) words.push(current)
  return words
}

export function commandPrefix(value: string | undefined, fallback: string): string[] {
  const words = shellWords((value ?? '').trim())
  return words.length ? words : [fallback]
}

export function commandLine(prefix: string[], args: string[]): string {
  return [...prefix, ...args].map(shellArg).join(' ')
}

export const DEFAULT_FORWARDED_AGENT_ENV = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'OPENAI_API_KEY',
]

export function forwardedEnvObject(names: string[], env: Record<string, string | undefined>, onInvalid?: (name: string) => void): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rawName of names) {
    const name = rawName.trim()
    if (!name) continue
    if (!validEnvName(name)) {
      onInvalid?.(name)
      continue
    }
    if (!Object.prototype.hasOwnProperty.call(env, name)) continue
    result[name] = env[name] ?? ''
  }
  return result
}

export const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export function validEnvName(name: string): boolean {
  return ENV_NAME_RE.test(name)
}

export function forwardedEnvExports(names: string[], env: Record<string, string | undefined>, onInvalid?: (name: string) => void): string {
  return Object.entries(forwardedEnvObject(names, env, onInvalid))
    .map(([name, value]) => `${name}=${shellArg(value)}`)
    .join(' ')
}
