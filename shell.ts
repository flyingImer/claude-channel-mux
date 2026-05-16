export function shellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export function validEnvName(name: string): boolean {
  return ENV_NAME_RE.test(name)
}

export function forwardedEnvExports(names: string[], env: Record<string, string | undefined>, onInvalid?: (name: string) => void): string {
  return names
    .map(name => name.trim())
    .filter(Boolean)
    .filter(name => {
      if (!validEnvName(name)) {
        onInvalid?.(name)
        return false
      }
      return Object.prototype.hasOwnProperty.call(env, name)
    })
    .map(name => `${name}=${shellArg(env[name] ?? '')}`)
    .join(' ')
}
