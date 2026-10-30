export const EXPIRY_WARNING_DAYS = 90

export function formatPKR(value) {
  const n = Number(value) || 0
  return `PKR ${n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Whole days from today (local calendar) to a YYYY-MM-DD date; negative once expired, null if unset
export function daysUntil(dateOnly) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly ?? '')) return null
  const [y, m, d] = dateOnly.split('-').map(Number)
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((Date.UTC(y, m - 1, d) - today) / 86_400_000)
}

// 'expired' | 'soon' | null, for styling expiry dates consistently across pages
export function expiryStatus(dateOnly) {
  const days = daysUntil(dateOnly)
  if (days === null) return null
  if (days < 0) return 'expired'
  if (days <= EXPIRY_WARNING_DAYS) return 'soon'
  return null
}

export function formatLocalDate(iso) {
  return iso ? new Date(iso).toLocaleDateString() : ''
}
