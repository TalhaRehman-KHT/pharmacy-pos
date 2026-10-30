// Input helpers shared by the db modules. No db access, so it can be imported at any time.

// Trimmed string, or null when missing or blank
export function clean(value) {
  if (value == null) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

export function round2(n) {
  return Math.round(n * 100) / 100
}

// A non-negative amount rounded to paisa, or null when missing or invalid
export function toMoney(value) {
  const s = clean(value)
  if (s === null) return null
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return null
  return round2(n)
}

export function toId(id, label) {
  const n = Number(id)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid ${label} id.`)
  return n
}

// Expiry dates are local calendar dates (YYYY-MM-DD), so compare against the pharmacy's local today, not UTC
export function todayLocal() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
