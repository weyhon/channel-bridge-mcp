import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

type JsonObject = Record<string, unknown>
type RpcMessage = { id?: number | string; method?: string; params?: JsonObject; result?: JsonObject; error?: JsonObject }

export type CodexBridgeOptions = {
  binary: string
  cwd: string
  model?: string
  reasoningEffort?: string
  developerInstructions?: string
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'
  approvalPolicy: 'untrusted' | 'on-request' | 'never'
  threadMapFile: string
}

export type CodexTurnInput = {
  text: string
  imagePaths?: string[]
  filePaths?: string[]
}

type PendingRequest = {
  resolve: (value: JsonObject) => void
  reject: (error: Error) => void
}

type TurnWaiter = {
  chunks: string[]
  finalText?: string
  resolve: (text: string) => void
  reject: (error: Error) => void
}

export class CodexAppServer {
  private process: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private pending = new Map<number | string, PendingRequest>()
  private turnWaiters = new Map<string, TurnWaiter>()
  private threadMap: Record<string, string> = {}
  private loadedThreads = new Set<string>()
  private queues = new Map<string, Promise<unknown>>()

  constructor(private readonly options: CodexBridgeOptions) {}

  async start(): Promise<void> {
    try {
      this.threadMap = JSON.parse(await readFile(this.options.threadMapFile, 'utf8')) as Record<string, string>
    } catch {}

    this.process = spawn(this.options.binary, ['app-server', '--stdio'], {
      cwd: this.options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    })
    this.process.stderr.on('data', chunk => process.stderr.write(`codex app-server: ${chunk}`))
    this.process.once('exit', (code, signal) => {
      const error = new Error(`codex app-server exited (code=${code}, signal=${signal})`)
      for (const request of this.pending.values()) request.reject(error)
      for (const turn of this.turnWaiters.values()) turn.reject(error)
      this.pending.clear()
      this.turnWaiters.clear()
    })

    const lines = createInterface({ input: this.process.stdout })
    lines.on('line', line => this.handleLine(line))

    await this.request('initialize', {
      clientInfo: { name: 'channel_bridge_mcp', title: 'Channel Bridge MCP', version: '0.3.1' },
      capabilities: { experimentalApi: true },
    })
    this.notify('initialized', {})
  }

  async stop(): Promise<void> {
    if (!this.process) return
    this.process.kill('SIGTERM')
    this.process = null
  }

  async runTurn(channelThreadKey: string, input: CodexTurnInput): Promise<string> {
    const previous = this.queues.get(channelThreadKey) ?? Promise.resolve()
    const current = previous.then(() => this.runTurnUnlocked(channelThreadKey, input))
    this.queues.set(channelThreadKey, current.catch(() => undefined))
    return current
  }

  private async runTurnUnlocked(channelThreadKey: string, input: CodexTurnInput): Promise<string> {
    const threadId = await this.ensureThread(channelThreadKey)
    const userInput: JsonObject[] = [{ type: 'text', text: this.withFileContext(input.text, input.filePaths), text_elements: [] }]
    for (const path of input.imagePaths ?? []) userInput.push({ type: 'localImage', path })

    const response = await this.request('turn/start', {
      threadId,
      input: userInput,
      cwd: this.options.cwd,
      approvalPolicy: this.options.approvalPolicy,
      sandboxPolicy: this.sandboxPolicy(),
      ...(this.options.reasoningEffort ? { effort: this.options.reasoningEffort } : {}),
    })
    const turn = response.turn as JsonObject | undefined
    const turnId = String(turn?.id ?? '')
    if (!turnId) throw new Error('turn/start did not return a turn id')

    return new Promise<string>((resolve, reject) => {
      this.turnWaiters.set(turnId, { chunks: [], resolve, reject })
    })
  }

  private async ensureThread(channelThreadKey: string): Promise<string> {
    const existing = this.threadMap[channelThreadKey]
    if (existing && !this.loadedThreads.has(existing)) {
      try {
        await this.request('thread/resume', {
          threadId: existing,
          cwd: this.options.cwd,
          approvalPolicy: this.options.approvalPolicy,
          sandbox: this.options.sandbox,
          ...(this.options.model ? { model: this.options.model } : {}),
          ...(this.options.developerInstructions
            ? { developerInstructions: this.options.developerInstructions }
            : {}),
        })
        this.loadedThreads.add(existing)
        return existing
      } catch {
        delete this.threadMap[channelThreadKey]
      }
    } else if (existing) {
      return existing
    }

    const response = await this.request('thread/start', {
      cwd: this.options.cwd,
      approvalPolicy: this.options.approvalPolicy,
      sandbox: this.options.sandbox,
      ...(this.options.model ? { model: this.options.model } : {}),
      ...(this.options.developerInstructions
        ? { developerInstructions: this.options.developerInstructions }
        : {}),
    })
    const thread = response.thread as JsonObject | undefined
    const threadId = String(thread?.id ?? '')
    if (!threadId) throw new Error('thread/start did not return a thread id')
    this.threadMap[channelThreadKey] = threadId
    this.loadedThreads.add(threadId)
    await mkdir(dirname(this.options.threadMapFile), { recursive: true, mode: 0o700 })
    await writeFile(this.options.threadMapFile, `${JSON.stringify(this.threadMap, null, 2)}\n`, { mode: 0o600 })
    return threadId
  }

  private withFileContext(text: string, files?: string[]): string {
    if (!files?.length) return text
    return `${text}\n\nSlack attachments downloaded to:\n${files.map(path => `- ${path}`).join('\n')}`
  }

  private sandboxPolicy(): JsonObject {
    switch (this.options.sandbox) {
      case 'danger-full-access': return { type: 'dangerFullAccess' }
      case 'read-only': return { type: 'readOnly', networkAccess: false }
      default:
        return {
          type: 'workspaceWrite', writableRoots: [this.options.cwd], networkAccess: true,
          excludeTmpdirEnvVar: false, excludeSlashTmp: false,
        }
    }
  }

  private handleLine(line: string): void {
    let message: RpcMessage
    try {
      message = JSON.parse(line) as RpcMessage
    } catch {
      process.stderr.write(`codex app-server: invalid JSONL: ${line}\n`)
      return
    }

    if (message.id !== undefined && (message.result || message.error)) {
      const request = this.pending.get(message.id)
      if (!request) return
      this.pending.delete(message.id)
      if (message.error) request.reject(new Error(String(message.error.message ?? JSON.stringify(message.error))))
      else request.resolve(message.result ?? {})
      return
    }

    if (message.id !== undefined && message.method) {
      this.handleServerRequest(message)
      return
    }

    const params = message.params ?? {}
    const turnId = String(params.turnId ?? (params.turn as JsonObject | undefined)?.id ?? '')
    if (!turnId) return
    const waiter = this.turnWaiters.get(turnId)
    if (!waiter) return

    if (message.method === 'item/agentMessage/delta') {
      waiter.chunks.push(String(params.delta ?? ''))
    } else if (message.method === 'item/completed') {
      const item = params.item as JsonObject | undefined
      if (item?.type === 'agentMessage' && item.text) waiter.finalText = String(item.text)
    } else if (message.method === 'turn/completed') {
      this.turnWaiters.delete(turnId)
      const turn = params.turn as JsonObject | undefined
      const status = String(turn?.status ?? 'unknown')
      if (status === 'completed') waiter.resolve(waiter.chunks.join('').trim() || waiter.finalText?.trim() || '(Codex completed without a text response)')
      else waiter.reject(new Error(`Codex turn ended with status: ${status}`))
    }
  }

  private handleServerRequest(message: RpcMessage): void {
    // MVP is deliberately non-interactive. `never` means Codex declines actions
    // that require approval instead of letting a Slack-triggered run hang.
    const method = message.method ?? ''
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
      this.send({ id: message.id, result: { decision: 'decline' } })
      return
    }
    this.send({ id: message.id, error: { code: -32601, message: `unsupported server request: ${method}` } })
  }

  private request(method: string, params: JsonObject): Promise<JsonObject> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send({ method, id, params })
    })
  }

  private notify(method: string, params: JsonObject): void {
    this.send({ method, params })
  }

  private send(message: RpcMessage): void {
    if (!this.process?.stdin.writable) throw new Error('codex app-server is not running')
    this.process.stdin.write(`${JSON.stringify(message)}\n`)
  }
}
