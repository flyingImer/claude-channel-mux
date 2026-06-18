import { test, expect } from 'bun:test'
import { TelegramAdapter } from '../adapters/telegram.ts'
import { bindingsFromJson, normalizeBinding, serializeBinding } from '../bindings.ts'

test('Telegram reports unsupported lifecycle operations with structured facts', async () => {
  const telegram = new TelegramAdapter({ token: 'test-token', inboxDir: '/tmp' })

  await expect(telegram.createRoomWithBotInvited?.({ parentRoomId: '-1001', desiredRoomName: 'ccm-worker' })).resolves.toEqual({
    ok: false,
    code: 'unsupported_capability',
    platform: 'telegram',
    operation: 'create_room_with_bot_invited',
  })

  await expect(telegram.archiveRoom?.({ roomId: '-1002' })).resolves.toEqual({
    ok: false,
    code: 'unsupported_capability',
    platform: 'telegram',
    operation: 'archive_room',
  })
})

test('legacy orchestrator room flag migrates to orchestrator capability on parse and serialization', () => {
  const parsed = bindingsFromJson({
    'slack:C1': { active: 'codex', isOrchestrator: true, sessions: { codex: 's1' } },
    'slack:C2': { isOrchestrator: true },
  })

  expect(parsed['slack:C1']).toEqual({ active: 'codex', orchestrator: true, sessions: { codex: 's1' } })
  expect(parsed['slack:C2']).toEqual({ orchestrator: true })
  expect(normalizeBinding(parsed['slack:C1'], 'claude').isOrchestrator).toBe(true)
  expect(serializeBinding(normalizeBinding(parsed['slack:C1'], 'claude'), 'claude')).toEqual({ active: 'codex', orchestrator: true, sessions: { codex: 's1' } })
})
