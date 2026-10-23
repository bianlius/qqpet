/** `done/total` for a clear completed/total; null when total is missing or not positive. */
export function progressMark(done: number, total: number): string | null {
  if (!Number.isFinite(total) || total <= 0) return null
  const max = Math.floor(total)
  const n = Number.isFinite(done) ? Math.max(0, Math.floor(done)) : 0
  return `${Math.min(n, max)}/${max}`
}
