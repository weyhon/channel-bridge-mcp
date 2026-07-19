export type SlackMessageRoute = {
  isDirectMessage: boolean
  sessionKey: string
  replyThreadTs?: string
}

/**
 * Channel conversations are thread-owned, while a top-level DM is one
 * continuous conversation. A user can still deliberately enter a DM thread;
 * in that case we preserve the thread and isolate its session.
 */
export function buildSlackMessageRoute(
  channelId: string,
  messageId: string,
  threadTs?: string,
): SlackMessageRoute {
  const isDirectMessage = channelId.startsWith('D')
  if (isDirectMessage && !threadTs) {
    return { isDirectMessage, sessionKey: `dm:${channelId}` }
  }

  const rootTs = threadTs ?? messageId
  return {
    isDirectMessage,
    sessionKey: `${channelId}:${rootTs}`,
    replyThreadTs: rootTs,
  }
}
