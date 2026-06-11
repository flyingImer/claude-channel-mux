import { readFileSync } from 'fs'
import { test, expect } from 'bun:test'

test('MCP exposes only the V1 room lifecycle tools with room token fields', () => {
  const server = readFileSync('server.ts', 'utf8')

  expect(server).toContain("name: 'create_room_with_bot_invited'")
  expect(server).toContain("name: 'archive_room'")
  expect(server).toContain("desired_room_name")
  expect(server).toContain("parent_chat_id")
  expect(server).toContain("ccm_room_token")
  expect(server).not.toContain("name: 'create_telegram_room'")
  expect(server).not.toContain("name: 'adopt_room'")
})

test('daemon room control routes are gated by token, adapter, and orchestrator flag', () => {
  const daemon = readFileSync('daemon.ts', 'utf8')

  expect(daemon).toContain('assertOrchestratorRoom(route.channelKey)')
  expect(daemon).toContain("case 'create_room_with_bot_invited'")
  expect(daemon).toContain("case 'archive_room'")
  expect(daemon).toContain('adapter.createRoomWithBotInvited')
  expect(daemon).toContain('adapter.archiveRoom')
  expect(daemon).toContain('JSON.stringify(resultFacts)')
  expect(daemon).toContain('Room is not flagged as an Agent Control Path orchestrator room')
  expect(daemon).toContain('Room lifecycle operation is not supported by')
})
