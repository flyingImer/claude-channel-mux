import { test, expect } from 'bun:test'
import type { WebClient } from '@slack/web-api'
import { SlackAdapter } from '../adapters/slack.ts'

type Call = { method: string; payload: Record<string, unknown> }

function fakeSlack(overrides: Partial<WebClient> = {}): { slack: SlackAdapter; calls: Call[] } {
  const slack = new SlackAdapter({ botToken: 'xoxb-test', appToken: 'xapp-test', inboxDir: '/tmp' })
  const calls: Call[] = []
  const web = {
    conversations: {
      create: async (payload: Record<string, unknown>) => {
        calls.push({ method: 'conversations.create', payload })
        return { channel: { id: 'CWORK', name: payload.name } }
      },
      invite: async (payload: Record<string, unknown>) => {
        calls.push({ method: 'conversations.invite', payload })
        return { ok: true }
      },
      members: async (payload: Record<string, unknown>) => {
        calls.push({ method: 'conversations.members', payload })
        return { members: ['UBOT', 'U1', 'U2', 'U3', 'U4'] }
      },
      info: async (payload: Record<string, unknown>) => {
        calls.push({ method: 'conversations.info', payload })
        return { channel: { id: payload.channel, name: 'worker', is_archived: false, is_member: true } }
      },
      archive: async (payload: Record<string, unknown>) => {
        calls.push({ method: 'conversations.archive', payload })
        return { ok: true }
      },
    },
    users: {
      info: async (payload: Record<string, unknown>) => {
        calls.push({ method: 'users.info', payload })
        const user = payload.user
        if (user === 'U2') return { user: { id: 'U2', is_bot: true } }
        if (user === 'U3') return { user: { id: 'U3', is_stranger: true } }
        if (user === 'U4') return { user: { id: 'U4', deleted: true } }
        return { user: { id: user, is_bot: false, is_stranger: false, deleted: false } }
      },
    },
    auth: { test: async () => ({ user_id: 'UBOT' }) },
    ...overrides,
  } as unknown as WebClient
  slack.injectWebClientForTest(web)
  slack.injectBotUserIdForTest('UBOT')
  return { slack, calls }
}

test('Slack creates private worker room and reports invite facts', async () => {
  const { slack, calls } = fakeSlack()

  const result = await slack.createRoomWithBotInvited({ parentRoomId: 'CPARENT', desiredRoomName: 'ccm-worker' })

  expect(result).toMatchObject({
    ok: true,
    operation: 'create_room_with_bot_invited',
    platform: 'slack',
    roomId: 'CWORK',
    roomName: 'ccm-worker',
    created: true,
    botUserId: 'UBOT',
    botInvite: 'already_in_room',
  })
  expect(calls.find(call => call.method === 'conversations.create')?.payload).toEqual({ name: 'ccm-worker', is_private: true })
  expect(calls.filter(call => call.method === 'conversations.invite').map(call => call.payload)).toEqual([{ channel: 'CWORK', users: 'U1' }])
  expect(result.ok && result.invitedUsers).toEqual([
    { userId: 'UBOT', status: 'skipped_bot' },
    { userId: 'U1', status: 'invited' },
    { userId: 'U2', status: 'skipped_bot' },
    { userId: 'U3', status: 'skipped_external' },
    { userId: 'U4', status: 'skipped_deactivated' },
  ])
})

test('Slack reports existing and archived worker-room facts without adopting policy', async () => {
  const { slack } = fakeSlack({
    conversations: {
      create: async () => {
        const error = new Error('name_taken') as Error & { data?: unknown }
        error.data = { error: 'name_taken', channel: { id: 'COLD', name: 'ccm-worker', is_archived: true } }
        throw error
      },
      info: async () => ({ channel: { id: 'COLD', name: 'ccm-worker', is_archived: true } }),
    },
  } as unknown as WebClient)

  await expect(slack.createRoomWithBotInvited({ parentRoomId: 'CPARENT', desiredRoomName: 'ccm-worker' })).resolves.toEqual({
    ok: false,
    operation: 'create_room_with_bot_invited',
    platform: 'slack',
    code: 'room_archived',
    roomId: 'COLD',
    roomName: 'ccm-worker',
    error: 'name_taken',
  })
})

test('Slack invites bot when created room does not report bot membership', async () => {
  const { slack, calls } = fakeSlack({
    conversations: {
      create: async (payload: Record<string, unknown>) => {
        calls.push({ method: 'conversations.create', payload })
        return { channel: { id: 'CWORK', name: payload.name } }
      },
      info: async (payload: Record<string, unknown>) => {
        calls.push({ method: 'conversations.info', payload })
        return { channel: { id: payload.channel, name: 'worker', is_archived: false, is_member: false } }
      },
      invite: async (payload: Record<string, unknown>) => {
        calls.push({ method: 'conversations.invite', payload })
        return { ok: true }
      },
      members: async () => ({ members: [] }),
    },
  } as unknown as WebClient)

  const result = await slack.createRoomWithBotInvited({ parentRoomId: 'CPARENT', desiredRoomName: 'ccm-worker' })

  expect(result.ok && result.botInvite).toBe('invited')
  expect(calls.filter(call => call.method === 'conversations.invite').map(call => call.payload)).toEqual([{ channel: 'CWORK', users: 'UBOT' }])
})

test('Slack archive returns structured success and failure facts', async () => {
  const { slack } = fakeSlack()
  await expect(slack.archiveRoom({ roomId: 'CWORK' })).resolves.toEqual({ ok: true, operation: 'archive_room', platform: 'slack', roomId: 'CWORK', archived: true })

  const failing = fakeSlack({
    conversations: {
      archive: async () => {
        const error = new Error('not_in_channel')
        throw error
      },
    },
  } as unknown as WebClient).slack
  await expect(failing.archiveRoom({ roomId: 'CWORK' })).resolves.toEqual({ ok: false, operation: 'archive_room', platform: 'slack', code: 'api_error', roomId: 'CWORK', error: 'not_in_channel' })
})
