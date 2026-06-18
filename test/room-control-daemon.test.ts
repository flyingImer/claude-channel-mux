import { readFileSync } from 'fs'
import { test, expect } from 'bun:test'
import { CCM_MCP_TOOLS } from '../mcp-tools.js'

test('MCP exposes the V1 room lifecycle and parent worker execution tools with bound-room routing', () => {
  const server = readFileSync('server.ts', 'utf8')
  const toolText = JSON.stringify(CCM_MCP_TOOLS)

  expect(server).toContain('tools: CCM_MCP_TOOLS')
  expect(toolText).toContain('create_room_with_bot_invited')
  expect(toolText).toContain('archive_room')
  expect(toolText).toContain('bind_worker_room')
  expect(toolText).toContain('start_worker_agent')
  expect(toolText).toContain('send_worker_task')
  expect(toolText).toContain('capture_worker_report')
  expect(toolText).toContain('get_current_ccm_context')
  expect(toolText).toContain('authorized_control_tools')
  expect(toolText).toContain('resolved')
  expect(toolText).toContain('ambiguous')
  expect(toolText).toContain('not_bound')
  expect(toolText).toContain('desired_room_name')
  expect(toolText).toContain('parent_chat_id')
  expect(toolText).toContain('chat_id is optional when the current CCM turn/session binding resolves to one room')
  expect(toolText).toContain('bind a worker room cwd/runtime metadata from the current Orchestrator parent room')
  expect(toolText).toContain('start or resume the assigned worker agent in a bound worker room from the current Orchestrator parent room')
  expect(toolText).toContain('send a bounded Worker Task to a started/bound worker room from the current Orchestrator parent room')
  expect(toolText).toContain('retrieve worker-room transcript/reportback facts from the current Orchestrator parent room')
  expect(toolText).toContain('Do not use the desired/new worker room as chat_id')
  expect(server).not.toContain("ccm_room_token")
  expect(toolText).not.toContain('create_telegram_room')
  expect(toolText).not.toContain('adopt_room')
})

test('Agent Control Path schemas allow resolver chat_id fallback where safe', () => {
  const currentContext = CCM_MCP_TOOLS.find(tool => tool.name === 'get_current_ccm_context')
  expect(currentContext?.inputSchema.required).toEqual([])
  expect(currentContext?.outputSchema?.required).toEqual(['status', 'authorized_control_tools'])
  expect(JSON.stringify(currentContext?.outputSchema)).toContain('authorized_control_tools')
  expect(JSON.stringify(currentContext?.outputSchema)).toContain('orchestrator_source')
  expect(JSON.stringify(currentContext?.outputSchema)).toContain('parent_room_id')
  expect(JSON.stringify(currentContext?.outputSchema)).toContain('resolved')
  expect(JSON.stringify(currentContext?.outputSchema)).toContain('ambiguous')
  expect(JSON.stringify(currentContext?.outputSchema)).toContain('not_bound')

  const createRoom = CCM_MCP_TOOLS.find(tool => tool.name === 'create_room_with_bot_invited')
  expect(createRoom?.inputSchema.required).toEqual(['desired_room_name'])
  expect(JSON.stringify(createRoom)).toContain('parent_chat_id defaults to the resolved/current Orchestrator parent room')

  for (const name of ['archive_room', 'bind_worker_room', 'start_worker_agent', 'send_worker_task', 'capture_worker_report'] as const) {
    const tool = CCM_MCP_TOOLS.find(candidate => candidate.name === name)
    expect(tool?.inputSchema.required).not.toContain('chat_id')
  }
})

test('daemon room control routes are gated by bound room, adapter, and orchestrator flag', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')

  expect(daemon).toContain('assertOrchestratorRoom(route.channelKey)')
  expect(daemon).toContain('currentCcmContextForSession(uuid: string, args: Record<string, unknown>)')
  expect(daemon).toContain('orchestratorToolChannelKey(uuid: string, requestedCk: string)')
  expect(daemon).toContain("msg.tool === 'get_current_ccm_context'")
  expect(daemon).toContain('resolveCurrentCcmContext(callerUuid')
  expect(daemon).toContain('requires an orchestrator room, but')
  expect(daemon).toContain('const parentChatId = stringValue(msg.args.parent_chat_id) || route.channelKey')
  expect(daemon).toContain("case 'create_room_with_bot_invited'")
  expect(daemon).toContain("case 'archive_room'")
  expect(daemon).toContain("case 'bind_worker_room'")
  expect(daemon).toContain("case 'start_worker_agent'")
  expect(daemon).toContain("case 'send_worker_task'")
  expect(daemon).toContain("case 'capture_worker_report'")
  expect(daemon).toContain('adapter.createRoomWithBotInvited')
  expect(daemon).toContain('adapter.archiveRoom')
  expect(daemon).toContain('setRoom(workerCk, cwd, runtime)')
  expect(daemon).toContain('setRoomWorkerRole(workerCk, route.channelKey)')
  expect(daemon).toContain('setRoomWorkerRole(channelKeyForRoomId(route.channelKey, resultFacts.roomId), route.channelKey)')
  expect(daemon).toContain("if (!cwd.startsWith('/')) throw new Error('cwd must be absolute')")
  expect(daemon).toContain('startNew(workerCk, roomCwd(workerCk), runtime, true, true)')
  expect(daemon).toContain("waitForLiveBridge(sessionId, 30_000)")
  expect(daemon).toContain("if (!sessionId) throw new Error('worker agent must be started before sending a task')")
  expect(daemon).toContain('call start_worker_agent before send_worker_task')
  expect(daemon).toContain('deliverUserTurn(workerCk')
  expect(daemon).toContain('workerTranscriptFacts(workerCk, runtime, limit)')
  expect(daemon).toContain("lastAssistantMessage: [...entries].reverse().find(entry => entry.role !== 'user')?.text")
  expect(daemon).toContain('JSON.stringify(resultFacts)')
  expect(daemon).toContain('Room is not flagged as an Agent Control Path orchestrator room')
  expect(daemon).toContain('Room lifecycle operation is not supported by')
})

test('daemon preflights Claude goals that request visible worker rooms', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')
  const helper = daemon.slice(daemon.indexOf('function claudeGoalRequiresOrchestrator'), daemon.indexOf('function zellijSync'))
  const slashBlock = daemon.slice(daemon.indexOf("    case 'slash':"), daemon.indexOf("    case 'new':"))

  expect(helper).toContain('/^\\/goal')
  for (const marker of ['orchestrate-workers', 'Worker Rooms?', 'Agent Control Path', 'create_room_with_bot_invited', 'bind_worker_room', 'start_worker_agent', 'send_worker_task', 'capture_worker_report']) {
    expect(helper).toContain(marker)
  }
  expect(helper).toContain('attention_needed — stopped before starting Claude `/goal`.')
  expect(helper).toContain('Run `/ccm orch on` in this room')
  expect(slashBlock).toContain('claudeGoalRequiresOrchestrator(cmd.command) && !normalizeBinding(loadBindings()[ck]).isOrchestrator')
  expect(slashBlock.indexOf('claudeGoalRequiresOrchestrator(cmd.command)')).toBeLessThan(slashBlock.indexOf('const uuid = bindingUuid(ck, runtime)'))
  expect(slashBlock.indexOf('claudeGoalRequiresOrchestrator(cmd.command)')).toBeLessThan(slashBlock.indexOf('writeChars(paneId, commandText)'))
})
