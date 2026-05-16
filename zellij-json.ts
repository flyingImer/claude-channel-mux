export type ZellijPane = {
  id: number
  tab_id?: number
  tab_name?: string
  is_plugin?: boolean
  exited?: boolean
  exit_status?: number | null
}

export type ZellijTab = {
  name: string
  tab_id: number
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function parseZellijJson(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}

export function zellijPanes(value: unknown): ZellijPane[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const record = recordValue(item)
    if (!record || typeof record.id !== 'number') return []
    let exitStatus: number | null | undefined
    if (typeof record.exit_status === 'number') exitStatus = record.exit_status
    else if (record.exit_status === null) exitStatus = null
    return [{
      id: record.id,
      tab_id: typeof record.tab_id === 'number' ? record.tab_id : undefined,
      tab_name: typeof record.tab_name === 'string' ? record.tab_name : undefined,
      is_plugin: typeof record.is_plugin === 'boolean' ? record.is_plugin : undefined,
      exited: typeof record.exited === 'boolean' ? record.exited : undefined,
      exit_status: exitStatus,
    }]
  })
}

export function zellijTabs(value: unknown): ZellijTab[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const record = recordValue(item)
    if (!record || typeof record.name !== 'string' || typeof record.tab_id !== 'number') return []
    return [{ name: record.name, tab_id: record.tab_id }]
  })
}
