import { test, expect } from 'bun:test'
import { compareTaskSnapshotItems, normalizeTaskStatus, taskSnapshotItemFromJson, taskSnapshotSortNumber, type TaskSnapshotItem } from '../tasks.ts'

test('normalizeTaskStatus accepts only known task statuses', () => {
  expect(normalizeTaskStatus('pending')).toBe('pending')
  expect(normalizeTaskStatus('in_progress')).toBe('in_progress')
  expect(normalizeTaskStatus('completed')).toBe('completed')
  expect(normalizeTaskStatus('blocked')).toBeNull()
})

test('taskSnapshotItemFromJson builds clean items from persisted task files', () => {
  expect(taskSnapshotItemFromJson({
    id: ' 42 ',
    subject: ' Do it ',
    activeForm: ' Doing it ',
    status: 'in_progress',
    blockedBy: ['1', 2, '3'],
  }, 'fallback.json')).toEqual({
    id: '42',
    text: 'Do it',
    activeText: 'Doing it',
    status: 'in_progress',
    blockedBy: ['1', '3'],
  })
})

test('taskSnapshotItemFromJson falls back to filename and drops invalid tasks', () => {
  expect(taskSnapshotItemFromJson({ content: ' Write tests ', status: 'pending' }, 'abc.json')).toEqual({
    id: 'abc',
    text: 'Write tests',
    status: 'pending',
    blockedBy: [],
  })
  expect(taskSnapshotItemFromJson({ subject: 'No status' }, 'x.json')).toBeUndefined()
  expect(taskSnapshotItemFromJson({ status: 'pending' }, 'x.json')).toBeUndefined()
  expect(taskSnapshotItemFromJson([], 'x.json')).toBeUndefined()
})


test('compareTaskSnapshotItems sorts only strict integer ids numerically', () => {
  expect(taskSnapshotSortNumber('10')).toBe(10)
  expect(taskSnapshotSortNumber('1e2')).toBeUndefined()
  expect(taskSnapshotSortNumber('10.5')).toBeUndefined()

  const item = (id: string): TaskSnapshotItem => ({ id, text: id, status: 'pending', blockedBy: [] })
  expect([item('10'), item('2'), item('1e2')].sort(compareTaskSnapshotItems).map(entry => entry.id)).toEqual(['2', '10', '1e2'])
})
