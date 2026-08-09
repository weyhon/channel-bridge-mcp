import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSlackMessageRoute } from '../src/slack-routing.js'

test('top-level DMs share one continuous session and reply without a thread', () => {
  const first = buildSlackMessageRoute('D1', '111.000')
  const second = buildSlackMessageRoute('D1', '222.000')

  assert.deepEqual(first, { isDirectMessage: true, sessionKey: 'dm:D1' })
  assert.deepEqual(second, { isDirectMessage: true, sessionKey: 'dm:D1' })
})

test('a deliberate DM thread stays isolated inside that thread', () => {
  assert.deepEqual(buildSlackMessageRoute('D1', '222.000', '111.000'), {
    isDirectMessage: true,
    sessionKey: 'D1:111.000',
    replyThreadTs: '111.000',
  })
})

test('channel roots and follow-ups use the owned thread session', () => {
  const root = buildSlackMessageRoute('C1', '111.000')
  const followup = buildSlackMessageRoute('C1', '222.000', '111.000')

  assert.deepEqual(root, {
    isDirectMessage: false,
    sessionKey: 'C1:111.000',
    replyThreadTs: '111.000',
  })
  assert.deepEqual(followup, root)
})
