import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { test, expect } from 'bun:test'
import { addInboxItem, addRecallPacket, assignWorkerRoom, loadOrchestrationProfile, markArchiveRequested, markInboxProcessed, markOutputConsumed, recordCreateResult, recordWorkerCapture, saveOrchestrationProfile } from '../orchestrator/state.ts'

function tempProfile() {
  const dir = mkdtempSync(join(tmpdir(), 'ccm-orch-state-'))
  const path = join(dir, 'orchestration.json')
  return { dir, path }
}

test('worker task id and desired room name are immutable after creation starts', () => {
  const profile = loadOrchestrationProfile('/tmp/missing-profile.json')
  const assigned = assignWorkerRoom(profile, { workerTaskId: 'task-1', desiredRoomName: 'ccm-task-1', topic: 'first' })
  expect(assigned.workerTaskId).toBe('task-1')
  expect(assigned.desiredRoomName).toBe('ccm-task-1')

  expect(() => assignWorkerRoom(profile, { workerTaskId: 'task-1', desiredRoomName: 'changed-name', topic: 'first' })).toThrow('desired_room_name is immutable')
})

test('same-task retry reuses mapping and records repair facts', () => {
  const profile = loadOrchestrationProfile('/tmp/missing-profile.json')
  assignWorkerRoom(profile, { workerTaskId: 'task-1', desiredRoomName: 'ccm-task-1', topic: 'first' })
  recordCreateResult(profile, 'task-1', { ok: false, operation: 'create_room_with_bot_invited', platform: 'slack', code: 'room_exists', roomId: 'CREPAIRED', roomName: 'ccm-task-1', error: 'name_taken' })

  const retry = assignWorkerRoom(profile, { workerTaskId: 'task-1', desiredRoomName: 'ccm-task-1', topic: 'first' })
  expect(retry.createIntent).toBe('repair_existing_room')
  expect(retry.roomId).toBe('CREPAIRED')
  expect((profile.workers['task-1'].createAttempts.at(-1) as { code?: string } | undefined)?.code).toBe('room_exists')
})

test('different task room-name collisions get a deterministic suffix', () => {
  const profile = loadOrchestrationProfile('/tmp/missing-profile.json')
  assignWorkerRoom(profile, { workerTaskId: 'task-1', desiredRoomName: 'ccm-worker', topic: 'first' })

  const second = assignWorkerRoom(profile, { workerTaskId: 'task-2', desiredRoomName: 'ccm-worker', topic: 'second' })
  expect(second.desiredRoomName).toBe('ccm-worker-task-2')
  expect(second.createIntent).toBe('create_new_room')
})

test('archive cannot be requested before output is consumed', () => {
  const profile = loadOrchestrationProfile('/tmp/missing-profile.json')
  assignWorkerRoom(profile, { workerTaskId: 'task-1', desiredRoomName: 'ccm-task-1', topic: 'first' })
  recordCreateResult(profile, 'task-1', { ok: true, operation: 'create_room_with_bot_invited', platform: 'slack', roomId: 'C1', roomName: 'ccm-task-1', created: true, botInvite: 'already_in_room', invitedUsers: [] })

  expect(() => markArchiveRequested(profile, 'task-1')).toThrow('worker output must be consumed before archive is requested')
  markOutputConsumed(profile, 'task-1', 'capture-1')
  expect(markArchiveRequested(profile, 'task-1').archive.requested).toBe(true)
})

test('profile persists deterministic JSON', () => {
  const { dir, path } = tempProfile()
  try {
    const profile = loadOrchestrationProfile(path)
    profile.orchestratorRoom = 'slack:CORCH'
    assignWorkerRoom(profile, { workerTaskId: 'task-1', desiredRoomName: 'ccm-task-1', topic: 'first' })
    saveOrchestrationProfile(path, profile)
    expect(loadOrchestrationProfile(path)).toEqual(profile)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('profile tracks capture, recall, and inbox placeholders without locking writes', () => {
  const profile = loadOrchestrationProfile('/tmp/missing-profile.json')
  profile.activeOrchestratorSession = { room: 'slack:CORCH', agentSessionId: 'diagnostic', lastSeenAt: '2026-06-11T00:00:00Z' }

  assignWorkerRoom(profile, { workerTaskId: 'task-1', desiredRoomName: 'ccm-task-1', topic: 'first' })
  recordWorkerCapture(profile, { captureId: 'capture-1', workerTaskId: 'task-1', path: 'captures/task-1.md' })
  addRecallPacket(profile, { recallId: 'recall-1', workerTaskId: 'task-1', question: 'Need human context?' })
  addInboxItem(profile, { path: 'inbox/001.md' })
  markInboxProcessed(profile, 'inbox/001.md')

  expect(profile.captures['capture-1']).toEqual({ captureId: 'capture-1', workerTaskId: 'task-1', path: 'captures/task-1.md', consumed: false })
  expect(profile.recallPackets['recall-1']).toEqual({ recallId: 'recall-1', workerTaskId: 'task-1', question: 'Need human context?', status: 'open' })
  expect(profile.inbox['inbox/001.md']).toEqual({ path: 'inbox/001.md', processed: true })
  expect(profile.workers['task-1'].workerTaskId).toBe('task-1')
})
