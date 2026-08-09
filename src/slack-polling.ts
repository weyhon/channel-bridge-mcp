export type SlackHistoryMessage = {
  ts?: string
  user?: string
  bot_id?: string
  subtype?: string
  text?: string
  thread_ts?: string
  files?: unknown[]
}

export function parsePollChannels(value: string | undefined): string[] {
  return [...new Set((value ?? '').split(',').map(channel => channel.trim()).filter(Boolean))]
}

function compareSlackTs(left: string, right: string): number {
  const leftKey = left.replace('.', '')
  const rightKey = right.replace('.', '')
  if (/^\d+$/.test(leftKey) && /^\d+$/.test(rightKey)) {
    const leftValue = BigInt(leftKey)
    const rightValue = BigInt(rightKey)
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
  }
  return left.localeCompare(right)
}

export function slackTsBefore(value: string): string {
  const match = value.match(/^(\d+)\.(\d+)$/)
  if (!match) return value
  const fractionWidth = match[2].length
  const units = BigInt(match[1]) * 10n ** BigInt(fractionWidth) + BigInt(match[2])
  if (units === 0n) return value
  const previous = (units - 1n).toString().padStart(fractionWidth + 1, '0')
  return `${previous.slice(0, -fractionWidth)}.${previous.slice(-fractionWidth)}`
}

export function isSlackTsRecent(value: string, nowMs = Date.now(), maxAgeMs = 10 * 60_000): boolean {
  const seconds = Number(value.split('.')[0])
  if (!Number.isFinite(seconds)) return false
  const ageMs = nowMs - seconds * 1000
  return ageMs >= 0 && ageMs <= maxAgeMs
}

export function orderMessagesAfter(
  messages: SlackHistoryMessage[],
  watermark: string | undefined,
): SlackHistoryMessage[] {
  return messages
    .filter(message => message.ts && (!watermark || compareSlackTs(message.ts, watermark) > 0))
    .sort((left, right) => compareSlackTs(left.ts!, right.ts!))
}
