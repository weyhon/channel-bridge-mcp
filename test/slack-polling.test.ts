import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isSlackTsRecent,
  orderMessagesAfter,
  parsePollChannels,
  slackTsBefore,
} from '../src/slack-polling.js'

test('parses and deduplicates configured Slack poll channels', () => {
  assert.deepEqual(parsePollChannels('D1, C1, D1,,'), ['D1', 'C1'])
})

test('orders only messages newer than the poll watermark', () => {
  const messages = [
    { ts: '1784811544.682869', text: 'newest' },
    { ts: '1784811491.049159', text: 'old' },
    { ts: '1784811503.531039', text: 'middle' },
  ]
  assert.deepEqual(orderMessagesAfter(messages, '1784811491.049159').map(message => message.text), [
    'middle',
    'newest',
  ])
})

test('creates a watermark immediately before an unhandled Slack message', () => {
  assert.equal(slackTsBefore('1784811774.265919'), '1784811774.265918')
  assert.equal(slackTsBefore('1784811774.000000'), '1784811773.999999')
})

test('only recovers an unhandled message from the recent restart window', () => {
  const nowMs = 1_784_811_800_000
  assert.equal(isSlackTsRecent('1784811774.265919', nowMs), true)
  assert.equal(isSlackTsRecent('1784463287.379069', nowMs), false)
})
