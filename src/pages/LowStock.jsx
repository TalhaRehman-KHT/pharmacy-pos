import { useEffect, useState } from 'react'
import Button from '../components/Button.jsx'
import EmptyState from '../components/EmptyState.jsx'
import Table from '../components/Table.jsx'
import Toast from '../components/Toast.jsx'
import { reports } from '../lib/api.js'
import './Reports.css'

export default function LowStock() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError('')
    reports
      .lowStock()
      .then((data) => !cancelled && setRows(data))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  return (
    <div className="report-page">
      <header className="page-header">
        <h1>Low Stock</h1>
        <Button onClick={() => setReloadKey((k) => k + 1)}>Refresh</Button>
      </header>

      <p className="muted report-note">
        Active medicines at or below their reorder level. Expired batches are not counted as stock.
      </p>

      {error && <Toast tone="error">{error}</Toast>}

      {rows === null ? (
        !error && <p className="muted">Loading...</p>
      ) : rows.length === 0 ? (
        <EmptyState>Nothing is at or below its reorder level.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Medicine</th>
              <th>Company</th>
              <th className="num">Current quantity</th>
              <th className="num">Reorder level</th>
              <th className="num">Shortfall</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.medicine_id}>
                <td>
                  <strong>{r.name}</strong>
                  {r.generic_name && <span className="muted"> · {r.generic_name}</span>}
                </td>
                <td>{r.company}</td>
                <td className={`num${r.quantity === 0 ? ' out-of-stock' : ''}`}>
                  {r.quantity} {r.unit}
                </td>
                <td className="num">{r.reorder_level}</td>
                <td className="num">{r.shortfall}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
