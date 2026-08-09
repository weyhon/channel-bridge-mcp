import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldRestartSocket } from '../src/slack-health.js'

test('does not restart an active Slack socket', () => {
  assert.equal(shouldRestartSocket({
    active: true,
    stateChangedAt: 0,
    now: 120_000,
    unhealthyRestartMs: 60_000,
  }), false)
})

test('allows a reconnect grace period before restarting the bridge', () => {
  assert.equal(shouldRestartSocket({
    active: false,
    stateChangedAt: 100_000,
    now: 159_999,
    unhealthyRestartMs: 60_000,
  }), false)
  assert.equal(shouldRestartSocket({
    active: false,
    stateChangedAt: 100_000,
    now: 160_000,
    unhealthyRestartMs: 60_000,
  }), true)
})
