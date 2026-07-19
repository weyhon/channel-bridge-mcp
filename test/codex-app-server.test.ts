import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CodexAppServer } from '../src/codex-app-server.js'

test('maps a Slack thread to Codex and returns streamed text', async () => {
  const state = await mkdtemp(join(tmpdir(), 'channel-bridge-codex-'))
  const mapFile = join(state, 'codex-threads.json')
  const traceFile = join(state, 'fake-codex.jsonl')
  process.env.FAKE_CODEX_TRACE_FILE = traceFile
  const app = new CodexAppServer({
    binary: resolve('test/fixtures/fake-codex.mjs'),
    cwd: process.cwd(),
    sandbox: 'workspace-write',
    approvalPolicy: 'never',
    developerInstructions: 'Reply in Chinese and protect irreversible actions.',
    threadMapFile: mapFile,
  })

  await app.start()
  try {
    const result = await app.runTurn('C1:123.456', { text: 'hello' })
    assert.equal(result, 'hello from Codex')
    assert.deepEqual(JSON.parse(await readFile(mapFile, 'utf8')), { 'C1:123.456': 'thread-test' })
    const requests = (await readFile(traceFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    const threadStart = requests.find(request => request.method === 'thread/start')
    assert.equal(threadStart.params.developerInstructions, 'Reply in Chinese and protect irreversible actions.')
  } finally {
    await app.stop()
    delete process.env.FAKE_CODEX_TRACE_FILE
  }
})

test('reapplies production settings when resuming a migrated Codex thread', async () => {
  const state = await mkdtemp(join(tmpdir(), 'channel-bridge-codex-resume-'))
  const mapFile = join(state, 'codex-threads.json')
  const traceFile = join(state, 'fake-codex.jsonl')
  const cwd = process.cwd()
  await writeFile(mapFile, `${JSON.stringify({ 'C1:999.000': 'thread-existing' })}\n`)
  process.env.FAKE_CODEX_TRACE_FILE = traceFile
  const app = new CodexAppServer({
    binary: resolve('test/fixtures/fake-codex.mjs'),
    cwd,
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    developerInstructions: 'Protect external side effects.',
    threadMapFile: mapFile,
  })

  await app.start()
  try {
    await app.runTurn('C1:999.000', { text: 'continue' })
    const requests = (await readFile(traceFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    const resume = requests.find(request => request.method === 'thread/resume')
    assert.deepEqual(resume.params, {
      threadId: 'thread-existing',
      cwd,
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
      developerInstructions: 'Protect external side effects.',
    })
  } finally {
    await app.stop()
    delete process.env.FAKE_CODEX_TRACE_FILE
  }
})

test('times out a stuck Codex request instead of hanging forever', async () => {
  const state = await mkdtemp(join(tmpdir(), 'channel-bridge-codex-timeout-'))
  process.env.FAKE_CODEX_HANG_METHOD = 'turn/start'
  const app = new CodexAppServer({
    binary: resolve('test/fixtures/fake-codex.mjs'),
    cwd: process.cwd(),
    home: join(state, 'codex-home'),
    sandbox: 'workspace-write',
    approvalPolicy: 'never',
    threadMapFile: join(state, 'codex-threads.json'),
    requestTimeoutMs: 1_000,
  })

  await app.start()
  try {
    await assert.rejects(
      app.runTurn('C1:timeout', { text: 'hello' }),
      /Codex request turn\/start timed out after 1000ms/,
    )
  } finally {
    await app.stop()
    delete process.env.FAKE_CODEX_HANG_METHOD
  }
})
