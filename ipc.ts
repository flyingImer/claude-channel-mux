export function ipcMessageFromLine(line: string): Record<string, unknown> | undefined {
  let parsed: unknown
  try { parsed = JSON.parse(line) } catch { return undefined }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
}
