#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { appendFileSync } from 'node:fs'

const lines = createInterface({ input: process.stdin })
lines.on('line', line => {
  const message = JSON.parse(line)
  if (process.env.FAKE_CODEX_TRACE_FILE) {
    appendFileSync(process.env.FAKE_CODEX_TRACE_FILE, `${JSON.stringify(message)}\n`)
  }
  if (message.method === 'initialize') {
    process.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'fake-codex' } })}\n`)
  } else if (message.method === 'thread/start') {
    process.stdout.write(`${JSON.stringify({ id: message.id, result: { thread: { id: 'thread-test' } } })}\n`)
  } else if (message.method === 'thread/resume') {
    process.stdout.write(`${JSON.stringify({ id: message.id, result: { thread: { id: message.params.threadId } } })}\n`)
  } else if (message.method === 'turn/start') {
    const turnId = 'turn-test'
    process.stdout.write(`${JSON.stringify({ id: message.id, result: { turn: { id: turnId } } })}\n`)
    setTimeout(() => {
      process.stdout.write(`${JSON.stringify({ method: 'item/agentMessage/delta', params: { turnId, delta: 'hello ' } })}\n`)
      process.stdout.write(`${JSON.stringify({ method: 'item/agentMessage/delta', params: { turnId, delta: 'from Codex' } })}\n`)
      process.stdout.write(`${JSON.stringify({ method: 'turn/completed', params: { turn: { id: turnId, status: 'completed' } } })}\n`)
    }, 10)
  }
})
