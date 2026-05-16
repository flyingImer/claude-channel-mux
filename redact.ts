export function redactSensitiveText(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-…redacted')
    .replace(/x(?:ox[baprs]|app)-[A-Za-z0-9-]{10,}/g, match => `${match.slice(0, 5)}…redacted`)
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_…redacted')
    .replace(/gh[pousr]_[A-Za-z0-9_]{10,}/g, match => `${match.slice(0, 4)}…redacted`)
    .replace(/(authorization\s*:\s*bearer\s+)([^\s,;]+)/gi, '$1…redacted')
    .replace(/(api[_-]?key|token|secret)(\s*[=:]\s*)([^\s,;]+)/gi, '$1$2…redacted')
}

export function errorMessage(err: unknown): string {
  return redactSensitiveText(err instanceof Error ? err.message : String(err))
}
