import { test, expect } from 'bun:test'
import { desiredHarnessWatchdogs, reconcileHarnessWatchdogs, harnessWatchdogUnit, HARNESS_WD_UNIT_PREFIX } from '../harness-watchdogs.js'

const resolve = (cwd: string, name: string) => (name === 'ghost' ? undefined : `${cwd.replace(/\/$/, '')}/.ccm-harness/${name}`)

test('desired set: one watchdog per harness dir, deduped across rooms, missing dir/script skipped', () => {
  const b = {
    'slack:A': { cwd: '/w', harness: 'tag' }, 'slack:B': { cwd: '/w/', harness: 'tag' },
    'slack:C': { cwd: '/w', harness: 'ghost' }, 'slack:D': { cwd: '/w', harness: 'noscript' }, 'slack:E': { cwd: '/w' },
  }
  const d = desiredHarnessWatchdogs(b, resolve, dir => !dir.endsWith('noscript'))
  expect(d.map(x => x.dir)).toEqual(['/w/.ccm-harness/tag'])
  expect(d[0]?.unit).toBe(harnessWatchdogUnit('tag', '/w/.ccm-harness/tag'))
  expect(d[0]?.unit.startsWith(HARNESS_WD_UNIT_PREFIX)).toBe(true)
})

test('reconcile: start missing, stop orphaned prefix units, restart on script change, leave others', () => {
  const d = desiredHarnessWatchdogs({ 'slack:A': { cwd: '/w', harness: 'tag' } }, resolve, () => true)
  const unit = d[0]!.unit
  const seen = new Map<string, number>()
  let a = reconcileHarnessWatchdogs(d, new Set([`${HARNESS_WD_UNIT_PREFIX}old-000000`, 'other.service']), () => 1, seen)
  expect(a.map(x => x.op + ':' + x.unit)).toEqual([`start:${unit}`, `stop:${HARNESS_WD_UNIT_PREFIX}old-000000`])
  a = reconcileHarnessWatchdogs(d, new Set([unit]), () => 1, seen)
  expect(a).toEqual([])
  a = reconcileHarnessWatchdogs(d, new Set([unit]), () => 2, seen)
  expect(a.map(x => x.op)).toEqual(['restart'])
})
