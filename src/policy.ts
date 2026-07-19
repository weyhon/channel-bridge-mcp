export type AccessPolicy = {
  allowUsers: string[]
  allowChannels: string[]
  requireMentionInChannel: boolean
  allowThreadFollowups: boolean
  ackReaction?: string
}

export type InboundContext = {
  userId: string
  channelId: string
  threadTs?: string
  mentioned: boolean
  knownThread: boolean
  isDirectMessage: boolean
}

export function shouldDeliver(policy: AccessPolicy, ctx: InboundContext): boolean {
  if (!policy.allowUsers.includes(ctx.userId)) return false
  if (ctx.isDirectMessage) return true
  if (!policy.allowChannels.includes(ctx.channelId)) return false
  if (ctx.threadTs && policy.allowThreadFollowups && ctx.knownThread) return true
  if (!policy.requireMentionInChannel) return true
  return ctx.mentioned
}
