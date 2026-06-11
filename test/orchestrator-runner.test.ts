import { test, expect } from 'bun:test'
import type { ArchiveRoomResult, CreateRoomWithBotInvitedResult } from '../adapters/types.ts'
import { emptyOrchestrationProfile } from '../orchestrator/state.ts'
import { runWorkerRoomStep, type OrchestratorCcmClient } from '../orchestrator/runner.ts'

function client(createResult: CreateRoomWithBotInvitedResult, archiveResult?: ArchiveRoomResult): { client: OrchestratorCcmClient; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    client: {
      createRoomWithBotInvited: async request => {
        calls.push(`create:${request.desiredRoomName}`)
        return createResult
      },
      archiveRoom: async request => {
        calls.push(`archive:${request.roomId}`)
        return archiveResult ?? { ok: true, operation: 'archive_room', platform: 'slack', roomId: request.roomId, archived: true }
      },
    },
  }
}

test('runner progresses create to consume to archive with injected CCM responses', async () => {
  const profile = emptyOrchestrationProfile()
  const harness = client({ ok: true, operation: 'create_room_with_bot_invited', platform: 'slack', roomId: 'C1', roomName: 'ccm-task-1', created: true, botInvite: 'already_in_room', invitedUsers: [] })

  let worker = await runWorkerRoomStep(profile, harness.client, { parentChatId: 'slack:CORCH', workerTaskId: 'task-1', desiredRoomName: 'ccm-task-1', topic: 'first' })
  expect(worker.roomId).toBe('C1')
  expect(worker.archive.requested).toBe(false)

  worker = await runWorkerRoomStep(profile, harness.client, { parentChatId: 'slack:CORCH', workerTaskId: 'task-1', desiredRoomName: 'ccm-task-1', topic: 'first', consumedCaptureId: 'capture-1' })
  expect(worker.output).toEqual({ captured: true, consumed: true, captureId: 'capture-1' })
  expect(worker.archive.requested).toBe(true)
  expect(worker.archive.result).toEqual({ ok: true, operation: 'archive_room', platform: 'slack', roomId: 'C1', archived: true })
  expect(harness.calls).toEqual(['create:ccm-task-1', 'archive:C1'])
})

test('runner records create failures and unsupported capability without archive', async () => {
  const profile = emptyOrchestrationProfile()
  const harness = client({ ok: false, code: 'unsupported_capability', platform: 'telegram', operation: 'create_room_with_bot_invited' })

  const worker = await runWorkerRoomStep(profile, harness.client, { parentChatId: 'telegram:1', workerTaskId: 'task-1', desiredRoomName: 'ccm-task-1' })

  expect(worker.createAttempts).toEqual([{ ok: false, code: 'unsupported_capability', platform: 'telegram', operation: 'create_room_with_bot_invited' }])
  expect(worker.roomId).toBeUndefined()
  expect(worker.archive.requested).toBe(false)
  expect(harness.calls).toEqual(['create:ccm-task-1'])
})

test('runner repair retry archives adopted room only after consumption', async () => {
  const profile = emptyOrchestrationProfile()
  const harness = client({ ok: false, operation: 'create_room_with_bot_invited', platform: 'slack', code: 'room_exists', roomId: 'COLD', roomName: 'ccm-task-1', error: 'name_taken' })

  let worker = await runWorkerRoomStep(profile, harness.client, { parentChatId: 'slack:CORCH', workerTaskId: 'task-1', desiredRoomName: 'ccm-task-1' })
  expect(worker.createIntent).toBe('repair_existing_room')
  expect(worker.archive.requested).toBe(false)

  worker = await runWorkerRoomStep(profile, harness.client, { parentChatId: 'slack:CORCH', workerTaskId: 'task-1', desiredRoomName: 'ccm-task-1', consumedCaptureId: 'capture-1' })
  expect(worker.archive.result).toEqual({ ok: true, operation: 'archive_room', platform: 'slack', roomId: 'COLD', archived: true })
  expect(harness.calls).toEqual(['create:ccm-task-1', 'archive:COLD'])
})
