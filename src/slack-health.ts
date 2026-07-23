export type SocketHealth = {
  active: boolean
  stateChangedAt: number
  now: number
  unhealthyRestartMs: number
}

export function shouldRestartSocket(health: SocketHealth): boolean {
  if (health.active) return false
  return health.now - health.stateChangedAt >= health.unhealthyRestartMs
}
