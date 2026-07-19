import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldDeliver, type AccessPolicy } from '../src/policy.js'

const policy: AccessPolicy = {
  allowUsers: ['U1'],
  allowChannels: ['C1'],
  requireMentionInChannel: true,
  allowThreadFollowups: true,
}

test('top-level channel message requires mention', () => {
  assert.equal(shouldDeliver(policy, {
    userId: 'U1', channelId: 'C1', mentioned: false, knownThread: false, isDirectMessage: false,
  }), false)
  assert.equal(shouldDeliver(policy, {
    userId: 'U1', channelId: 'C1', mentioned: true, knownThread: false, isDirectMessage: false,
  }), true)
})

test('known thread accepts follow-up without mention', () => {
  assert.equal(shouldDeliver(policy, {
    userId: 'U1', channelId: 'C1', threadTs: '123.456', mentioned: false,
    knownThread: true, isDirectMessage: false,
  }), true)
})

test('unknown users and channels are rejected', () => {
  assert.equal(shouldDeliver(policy, {
    userId: 'U2', channelId: 'C1', mentioned: true, knownThread: false, isDirectMessage: false,
  }), false)
  assert.equal(shouldDeliver(policy, {
    userId: 'U1', channelId: 'C2', mentioned: true, knownThread: false, isDirectMessage: false,
  }), false)
})
