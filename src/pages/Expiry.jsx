import { useEffect, useState } from 'react'
import Badge from '../components/Badge.jsx'
import Button from '../components/Button.jsx'
import EmptyState from '../components/EmptyState.jsx'
import Table from '../components/Table.jsx'
import Toast from '../components/Toast.jsx'
import { reports } from '../lib/api.js'
import { EXPIRY_WARNING_DAYS, daysUntil, formatPKR } from '../lib/format.js'
import './Reports.css'

export default function Expiry() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError('')
    reports
      .expiring(EXPIRY_WARNING_DAYS)
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  return (
    <div className="report-page">
      <header className="page-header">
        <h1>Expiry</h1>
        <Button onClick={() => setReloadKey((k) => k + 1)}>Refresh</Button>
      </header>

      <p className="muted report-note">Values are at purchase price: what the stock cost, not what it would sell for.</p>

      {error && <Toast tone="error">{error}</Toast>}
      {data === null && !error && <p className="muted">Loading...</p>}

      {data && (
        <>
          <BatchSection
            title={`Expiring within ${EXPIRY_WARNING_DAYS} days`}
            rows={data.expiring}
            empty={`No stock expires in the next ${EXPIRY_WARNING_DAYS} days.`}
            status="soon"
          />
          <BatchSection title="Already expired" rows={data.expired} empty="No expired stock on hand." status="expired" />
        </>
      )}
    </div>
  )
}

function BatchSection({ title, rows, empty, status }) {
  const totalQty = rows.reduce((sum, r) => sum + r.quantity, 0)
  const totalValue = rows.reduce((sum, r) => sum + r.value, 0)

  return (
    <section className="report-section">
      <h2 className="section-title">
        {title}
        {rows.length > 0 && (
          <span className="section-summary">
            {rows.length} batch{rows.length === 1 ? '' : 'es'} · {formatPKR(totalValue)} at cost
          </span>
        )}
      </h2>
      {rows.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Batch</th>
              <th>Medicine</th>
              <th className="num">Quantity</th>
              <th>Expiry</th>
              <th className="num">Value at cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.batch_no}</td>
                <td>
                  {r.name}
                  {!r.is_active && <Badge>Inactive</Badge>}
                </td>
                <td className="num">{r.quantity}</td>
                <td className={`expiry-${status}`}>
                  {r.expiry_date} <span className="days">{describeDays(daysUntil(r.expiry_date))}</span>
                </td>
                <td className="num">{formatPKR(r.value)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Total</td>
              <td className="num">{totalQty}</td>
              <td />
              <td className="num">{formatPKR(totalValue)}</td>
            </tr>
          </tfoot>
        </Table>
      )}
    </section>
  )
}

function describeDays(days) {
  if (days === null) return ''
  if (days === 0) return '(today)'
  if (days < 0) return `(${-days} day${days === -1 ? '' : 's'} ago)`
  return `(in ${days} day${days === 1 ? '' : 's'})`
}
