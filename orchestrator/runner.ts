import type { ArchiveRoomRequest, ArchiveRoomResult, CreateRoomWithBotInvitedRequest, CreateRoomWithBotInvitedResult } from '../adapters/types.js'
import { assignWorkerRoom, markArchiveRequested, markOutputConsumed, recordArchiveResult, recordCreateResult, type OrchestrationProfile, type WorkerState } from './state.js'

export type OrchestratorCcmClient = {
  createRoomWithBotInvited(request: CreateRoomWithBotInvitedRequest): Promise<CreateRoomWithBotInvitedResult>
  archiveRoom(request: ArchiveRoomRequest): Promise<ArchiveRoomResult>
}

export type WorkerRoomStep = {
  parentChatId: string
  workerTaskId: string
  desiredRoomName: string
  topic?: string
  consumedCaptureId?: string
}

function localRoomId(channelKey: string): string {
  const separator = channelKey.indexOf(':')
  return separator === -1 ? channelKey : channelKey.slice(separator + 1)
}

export async function runWorkerRoomStep(profile: OrchestrationProfile, ccm: OrchestratorCcmClient, step: WorkerRoomStep): Promise<WorkerState> {
  const worker = assignWorkerRoom(profile, { workerTaskId: step.workerTaskId, desiredRoomName: step.desiredRoomName, topic: step.topic })

  if (worker.createAttempts.length === 0) {
    const createResult = await ccm.createRoomWithBotInvited({ parentRoomId: localRoomId(step.parentChatId), desiredRoomName: worker.desiredRoomName })
    recordCreateResult(profile, worker.workerTaskId, createResult)
  }

  if (step.consumedCaptureId) markOutputConsumed(profile, worker.workerTaskId, step.consumedCaptureId)

  if (worker.output.consumed && worker.roomId && !worker.archive.requested) {
    markArchiveRequested(profile, worker.workerTaskId)
    const archiveResult = await ccm.archiveRoom({ roomId: worker.roomId })
    recordArchiveResult(profile, worker.workerTaskId, archiveResult)
  }

  return worker
}
