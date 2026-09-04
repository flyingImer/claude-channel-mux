// Harness watchdog supervision: the daemon DECIDES which watchdogs must run (one per harness
// instance dir referenced by any binding, whose watchdog.sh exists); systemd --user SUPERVISES
// them as transient units (Restart=always), so a daemon restart never kills a watchdog and a
// retired harness (no binding references it) is stopped. Pure functions here; execution lives in
// daemon.ts (ensureHarnessWatchdogs).
import { createHash } from 'crypto'
import { join } from 'path'
import type { ChannelBinding } from './bindings.js'

export const HARNESS_WD_UNIT_PREFIX = 'ccm-harness-wd-'
export type DesiredWatchdog = { unit: string; name: string; dir: string; cwd: string; script: string; log: string }

export function harnessWatchdogUnit(name: string, dir: string): string {
  const safe = name.replace(/[^A-Za-z0-9_.-]/g, '_')
  return `${HARNESS_WD_UNIT_PREFIX}${safe}-${createHash('sha1').update(dir).digest('hex').slice(0, 6)}`
}

/** Desired set from bindings: dedupe by resolved dir. `resolveDir` maps (cwd, name) -> absolute
 *  harness dir or undefined when it does not exist; `hasScript` checks <dir>/watchdog.sh. */
export function desiredHarnessWatchdogs(
  bindings: Record<string, ChannelBinding>,
  resolveDir: (cwd: string, name: string) => string | undefined,
  hasScript: (dir: string) => boolean,
): DesiredWatchdog[] {
  const out = new Map<string, DesiredWatchdog>()
  for (const b of Object.values(bindings)) {
    if (!b?.harness || !b.cwd) continue
    const dir = resolveDir(b.cwd, b.harness)
    if (!dir || out.has(dir) || !hasScript(dir)) continue
    out.set(dir, { unit: harnessWatchdogUnit(b.harness, dir), name: b.harness, dir, cwd: b.cwd, script: join(dir, 'watchdog.sh'), log: join(dir, 'watchdog.log') })
  }
  return [...out.values()].sort((a, b) => a.unit.localeCompare(b.unit))
}

export type WatchdogAction = { op: 'start' | 'stop' | 'restart'; unit: string; wd?: DesiredWatchdog; reason: string }

/** Reconcile desired vs running (unit names) vs known script mtimes. */
export function reconcileHarnessWatchdogs(
  desired: DesiredWatchdog[],
  running: Set<string>,
  scriptMtime: (script: string) => number | undefined,
  seenMtime: Map<string, number>,
): WatchdogAction[] {
  const actions: WatchdogAction[] = []
  const want = new Set(desired.map(d => d.unit))
  for (const d of desired) {
    const m = scriptMtime(d.script)
    if (!running.has(d.unit)) actions.push({ op: 'start', unit: d.unit, wd: d, reason: 'not running' })
    else if (m !== undefined && seenMtime.has(d.unit) && seenMtime.get(d.unit) !== m) actions.push({ op: 'restart', unit: d.unit, wd: d, reason: 'watchdog.sh changed' })
    if (m !== undefined) seenMtime.set(d.unit, m)
  }
  for (const u of running) if (u.startsWith(HARNESS_WD_UNIT_PREFIX) && !want.has(u)) actions.push({ op: 'stop', unit: u, reason: 'no binding references this harness' })
  return actions
}
