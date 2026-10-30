import { useCallback, useState } from 'react'

// Briefly highlights the table row that was just added or saved (styles in components/Table.css):
//   const [rowFlash, flashRow] = useRowFlash()
//   flashRow(savedId) after the save; <tr className={rowFlash(row.id)}> when rendering.
// Purely visual; the row is never held back for it.
export function useRowFlash() {
  const [flash, setFlash] = useState({ id: null, n: 0 })
  const flashRow = useCallback((id) => setFlash((f) => ({ id, n: f.n + 1 })), [])
  const rowFlash = (id) => (flash.id !== null && id === flash.id ? (flash.n % 2 ? 'flash-a' : 'flash-b') : undefined)
  return [rowFlash, flashRow]
}
