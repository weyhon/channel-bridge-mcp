#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { chmodSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { SocketModeClient } from '@slack/socket-mode'
import { WebClient } from '@slack/web-api'
import { shouldDeliver, type AccessPolicy } from './policy.js'
import { CodexAppServer } from './codex-app-server.js'

const stateDir = process.env.CHANNEL_BRIDGE_STATE_DIR ?? join(homedir(), '.claude', 'channels', 'channel-bridge')
const envFile = join(stateDir, '.env')
const accessFile = join(stateDir, 'access.json')
const threadsFile = join(stateDir, 'threads.json')
const inboxDir = join(stateDir, 'inbox')

async function loadLocalEnv(): Promise<void> {
  try {
    chmodSync(envFile, 0o600)
    const raw = await readFile(envFile, 'utf8')
    for (const line of raw.split('\n')) {
      const match = /^(\w+)=(.*)$/.exec(line)
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2]
    }
  } catch {}
}

await loadLocalEnv()
const runtime = (process.env.BRIDGE_RUNTIME ?? 'claude').toLowerCase()
if (runtime !== 'claude' && runtime !== 'codex') {
  throw new Error('BRIDGE_RUNTIME must be "claude" or "codex"')
}
const botToken = process.env.SLACK_BOT_TOKEN
const appToken = process.env.SLACK_APP_TOKEN
if (!botToken || !appToken) {
  process.stderr.write(`channel-bridge: SLACK_BOT_TOKEN and SLACK_APP_TOKEN are required in ${envFile}\n`)
  process.exit(1)
}

const defaultPolicy: AccessPolicy = {
  allowUsers: [],
  allowChannels: [],
  requireMentionInChannel: true,
  allowThreadFollowups: true,
  ackReaction: 'eyes',
}

async function loadPolicy(): Promise<AccessPolicy> {
  try {
    const parsed = JSON.parse(await readFile(accessFile, 'utf8')) as Partial<AccessPolicy>
    return { ...defaultPolicy, ...parsed }
  } catch {
    return defaultPolicy
  }
}

let knownThreads = new Set<string>()
try {
  knownThreads = new Set(JSON.parse(await readFile(threadsFile, 'utf8')) as string[])
} catch {}

async function rememberThread(channel: string, threadTs: string): Promise<void> {
  knownThreads.add(`${channel}:${threadTs}`)
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  await writeFile(threadsFile, `${JSON.stringify([...knownThreads], null, 2)}\n`, { mode: 0o600 })
}

function threadKey(channel: string, threadTs: string): string {
  return `${channel}:${threadTs}`
}

function stripMention(text: string, botUserId: string): string {
  return text.replace(new RegExp(`<@${botUserId}>`, 'g'), '').trim()
}

const web = new WebClient(botToken)
const socket = new SocketModeClient({ appToken })
const auth = await web.auth.test()
const botUserId = auth.user_id
if (!botUserId) throw new Error('Slack auth.test did not return the bot user ID')

const codex = runtime === 'codex'
  ? new CodexAppServer({
      binary: process.env.CODEX_BIN ?? 'codex',
      cwd: process.env.CODEX_CWD ?? process.cwd(),
      model: process.env.CODEX_MODEL,
      reasoningEffort: process.env.CODEX_REASONING_EFFORT,
      developerInstructions: process.env.CODEX_DEVELOPER_INSTRUCTIONS,
      sandbox: (process.env.CODEX_SANDBOX ?? 'workspace-write') as 'read-only' | 'workspace-write' | 'danger-full-access',
      approvalPolicy: (process.env.CODEX_APPROVAL_POLICY ?? 'never') as 'untrusted' | 'on-request' | 'never',
      threadMapFile: join(stateDir, 'codex-threads.json'),
    })
  : null

const mcp = new Server(
  { name: 'channel-bridge-mcp', version: '0.3.0' },
  {
    capabilities: {
      tools: {},
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {},
      },
    },
    instructions:
      'Slack messages arrive through <channel source="slack" ...>. Reply with the reply tool using chat_id and thread_ts from message metadata. Attachments are metadata-only until download_attachment is called.',
  },
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Reply to a Slack channel or thread.',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: { type: 'string' },
          text: { type: 'string' },
          thread_ts: { type: 'string' },
        },
        required: ['chat_id', 'text'],
      },
    },
    {
      name: 'react',
      description: 'Add an emoji reaction to a Slack message.',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: { type: 'string' }, message_id: { type: 'string' }, emoji: { type: 'string' },
        },
        required: ['chat_id', 'message_id', 'emoji'],
      },
    },
    {
      name: 'edit_message',
      description: 'Edit a message previously sent by this Slack bot.',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: { type: 'string' }, message_id: { type: 'string' }, text: { type: 'string' },
        },
        required: ['chat_id', 'message_id', 'text'],
      },
    },
    {
      name: 'fetch_messages',
      description: 'Fetch recent Slack channel messages or replies in a thread.',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: { type: 'string' }, thread_ts: { type: 'string' }, limit: { type: 'number' },
        },
        required: ['chat_id'],
      },
    },
    {
      name: 'download_attachment',
      description: 'Download Slack files attached to a message into the protected local inbox.',
      inputSchema: {
        type: 'object',
        properties: { chat_id: { type: 'string' }, message_id: { type: 'string' } },
        required: ['chat_id', 'message_id'],
      },
    },
  ],
}))

function textResult(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], ...(isError ? { isError: true } : {}) }
}

async function downloadInboundFiles(files: Array<Record<string, unknown>>): Promise<{ imagePaths: string[]; filePaths: string[] }> {
  const imagePaths: string[] = []
  const filePaths: string[] = []
  if (!files.length) return { imagePaths, filePaths }
  await mkdir(inboxDir, { recursive: true, mode: 0o700 })
  for (const file of files) {
    const url = String(file.url_private_download ?? file.url_private ?? '')
    if (!url) continue
    const id = String(file.id ?? Date.now())
    const safeName = String(file.name ?? id).replace(/[^\w.-]+/g, '_')
    const path = join(inboxDir, `${id}-${safeName}`)
    const response = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } })
    if (!response.ok) throw new Error(`Slack attachment download failed: HTTP ${response.status}`)
    await writeFile(path, Buffer.from(await response.arrayBuffer()), { mode: 0o600 })
    if (String(file.mimetype ?? '').startsWith('image/')) imagePaths.push(path)
    else filePaths.push(path)
  }
  return { imagePaths, filePaths }
}

async function postSlackReply(channel: string, threadTs: string, text: string): Promise<void> {
  const chunks = text.match(/[\s\S]{1,3500}/g) ?? ['(empty response)']
  for (const chunk of chunks) await web.chat.postMessage({ channel, thread_ts: threadTs, text: chunk })
}

async function assertAllowedChannel(channel: string): Promise<void> {
  const policy = await loadPolicy()
  if (!policy.allowChannels.includes(channel) && !channel.startsWith('D')) {
    throw new Error(`channel ${channel} is not allowlisted`)
  }
}

mcp.setRequestHandler(CallToolRequestSchema, async request => {
  const args = (request.params.arguments ?? {}) as Record<string, unknown>
  try {
    switch (request.params.name) {
      case 'reply': {
        const channel = String(args.chat_id)
        const threadTs = args.thread_ts ? String(args.thread_ts) : undefined
        await assertAllowedChannel(channel)
        const sent = await web.chat.postMessage({ channel, text: String(args.text), thread_ts: threadTs })
        if (threadTs) await rememberThread(channel, threadTs)
        return textResult(`sent (id: ${sent.ts ?? 'unknown'})`)
      }
      case 'react': {
        const channel = String(args.chat_id)
        await assertAllowedChannel(channel)
        await web.reactions.add({ channel, timestamp: String(args.message_id), name: String(args.emoji).replace(/^:|:$/g, '') })
        return textResult('reacted')
      }
      case 'edit_message': {
        const channel = String(args.chat_id)
        await assertAllowedChannel(channel)
        await web.chat.update({ channel, ts: String(args.message_id), text: String(args.text) })
        return textResult('edited')
      }
      case 'fetch_messages': {
        const channel = String(args.chat_id)
        await assertAllowedChannel(channel)
        const limit = Math.min(Number(args.limit ?? 20), 100)
        const response = args.thread_ts
          ? await web.conversations.replies({ channel, ts: String(args.thread_ts), limit })
          : await web.conversations.history({ channel, limit })
        const lines = (response.messages ?? []).map(message =>
          `[${message.ts}] ${message.user ?? message.bot_id ?? 'unknown'}: ${(message.text ?? '').replace(/[\r\n]+/g, ' ⏎ ')}${message.files?.length ? ` +${message.files.length}att` : ''}`,
        )
        return textResult(lines.join('\n') || '(no messages)')
      }
      case 'download_attachment': {
        const channel = String(args.chat_id)
        const messageId = String(args.message_id)
        await assertAllowedChannel(channel)
        const response = await web.conversations.replies({ channel, ts: messageId, limit: 1, inclusive: true })
        const message = response.messages?.find(item => item.ts === messageId) ?? response.messages?.[0]
        const files = message?.files ?? []
        await mkdir(inboxDir, { recursive: true, mode: 0o700 })
        const paths: string[] = []
        for (const file of files) {
          const url = file.url_private_download ?? file.url_private
          if (!url) continue
          const safeName = (file.name ?? file.id ?? 'attachment').replace(/[^\w.-]+/g, '_')
          const path = join(inboxDir, `${file.id ?? Date.now()}-${safeName}`)
          const download = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } })
          if (!download.ok) throw new Error(`download failed: HTTP ${download.status}`)
          await writeFile(path, Buffer.from(await download.arrayBuffer()), { mode: 0o600 })
          paths.push(path)
        }
        return textResult(paths.length ? `downloaded:\n${paths.join('\n')}` : 'message has no downloadable attachments')
      }
      default:
        return textResult(`unknown tool: ${request.params.name}`, true)
    }
  } catch (error) {
    return textResult(`${request.params.name} failed: ${error instanceof Error ? error.message : String(error)}`, true)
  }
})

const seen = new Set<string>()
socket.on('slack_event', async ({ body, ack }) => {
  await ack()
  const event = (body as { event?: Record<string, unknown> }).event
  if (!event || event.type !== 'message' && event.type !== 'app_mention') return
  if (event.bot_id || event.subtype) return

  const userId = String(event.user ?? '')
  const channelId = String(event.channel ?? '')
  const messageId = String(event.ts ?? '')
  if (!userId || !channelId || !messageId || seen.has(messageId)) return
  seen.add(messageId)
  if (seen.size > 500) seen.delete(seen.values().next().value!)

  const text = String(event.text ?? '')
  const threadTs = event.thread_ts ? String(event.thread_ts) : undefined
  const mentioned = event.type === 'app_mention' || text.includes(`<@${botUserId}>`)
  const rootTs = threadTs ?? messageId
  const policy = await loadPolicy()
  const deliver = shouldDeliver(policy, {
    userId,
    channelId,
    threadTs,
    mentioned,
    knownThread: threadTs ? knownThreads.has(threadKey(channelId, threadTs)) : false,
    isDirectMessage: channelId.startsWith('D'),
  })
  if (!deliver) return
  if (mentioned || channelId.startsWith('D')) await rememberThread(channelId, rootTs)

  if (policy.ackReaction) {
    void web.reactions.add({ channel: channelId, timestamp: messageId, name: policy.ackReaction }).catch(() => {})
  }

  const files = Array.isArray(event.files) ? event.files as Array<Record<string, unknown>> : []
  const attachments = files.map(file => `${file.name ?? file.id} (${file.mimetype ?? 'unknown'}, ${file.size ?? '?'}B)`)
  const content = stripMention(text, botUserId) || (attachments.length ? '请查看附件。' : '')
  if (codex) {
    try {
      const downloaded = await downloadInboundFiles(files)
      const response = await codex.runTurn(threadKey(channelId, rootTs), {
        text: content,
        imagePaths: downloaded.imagePaths,
        filePaths: downloaded.filePaths,
      })
      await postSlackReply(channelId, rootTs, response)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await postSlackReply(channelId, rootTs, `Codex 运行失败：${message}`)
    }
  } else {
    await (mcp as unknown as { notification(input: unknown): Promise<void> }).notification({
      method: 'notifications/claude/channel',
      params: {
        content,
        meta: {
          source: 'slack', chat_id: channelId, message_id: messageId, thread_ts: rootTs,
          user_id: userId, ts: messageId,
          ...(attachments.length ? { attachment_count: String(attachments.length), attachments: attachments.join('; ') } : {}),
        },
      },
    })
  }
})

if (codex) await codex.start()
else await mcp.connect(new StdioServerTransport())
await socket.start()
process.stderr.write(`channel-bridge: Slack connected as ${auth.user ?? botUserId} (runtime=${runtime})\n`)

async function shutdown(): Promise<void> {
  await socket.disconnect().catch(() => {})
  await codex?.stop().catch(() => {})
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
if (runtime === 'claude') process.stdin.on('end', () => void shutdown())
