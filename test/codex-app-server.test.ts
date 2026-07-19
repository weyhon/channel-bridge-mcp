import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CodexAppServer } from '../src/codex-app-server.js'

test('maps a Slack thread to Codex and returns streamed text', async () => {
  const state = await mkdtemp(join(tmpdir(), 'channel-bridge-codex-'))
  const mapFile = join(state, 'codex-threads.json')
  const app = new CodexAppServer({
    binary: resolve('test/fixtures/fake-codex.mjs'),
    cwd: process.cwd(),
    sandbox: 'workspace-write',
    approvalPolicy: 'never',
    threadMapFile: mapFile,
  })

  await app.start()
  try {
    const result = await app.runTurn('C1:123.456', { text: 'hello' })
    assert.equal(result, 'hello from Codex')
    assert.deepEqual(JSON.parse(await readFile(mapFile, 'utf8')), { 'C1:123.456': 'thread-test' })
  } finally {
    await app.stop()
  }
})
