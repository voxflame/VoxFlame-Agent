export function formatCompactDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60

  if (hours > 0) {
    return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`
  }

  if (minutes > 0) {
    return `${minutes} 分钟`
  }

  return seconds > 0 ? `${seconds} 秒` : '0 分钟'
}
