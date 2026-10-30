import { useEffect, useState } from 'react'
import Button from '../components/Button.jsx'
import Card from '../components/Card.jsx'
import { reports } from '../lib/api.js'
import { EXPIRY_WARNING_DAYS, formatPKR } from '../lib/format.js'
import './Reports.css'

// Each card runs its own query, so one failing or slow figure does not hold back the others
const CARDS = [
  { id: 'total', label: "Today's sales", load: () => reports.todaySalesTotal(), format: formatPKR },
  { id: 'bills', label: 'Bills today', load: () => reports.todayBillCount() },
  { id: 'low', label: 'Low stock items', load: () => reports.lowStockCount(), page: 'low-stock', warnAbove: 0 },
  {
    id: 'expiring',
    label: `Batches expiring within ${EXPIRY_WARNING_DAYS} days`,
    load: () => reports.expiringCount(EXPIRY_WARNING_DAYS),
    page: 'expiry',
    warnAbove: 0,
  },
]

export default function Dashboard({ onNavigate }) {
  const [reloadKey, setReloadKey] = useState(0)

  return (
    <div className="report-page">
      <header className="page-header">
        <h1>Dashboard</h1>
        <Button onClick={() => setReloadKey((k) => k + 1)}>Refresh</Button>
      </header>

      <div className="stat-grid">
        {CARDS.map((card) => (
          <StatCard key={`${card.id}-${reloadKey}`} card={card} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  )
}

function StatCard({ card, onNavigate }) {
  const [value, setValue] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    card
      .load()
      .then((v) => !cancelled && setValue(v))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [card])

  const warn = card.warnAbove !== undefined && value !== null && value > card.warnAbove
  const body = (
    <>
      <span className="stat-label">{card.label}</span>
      {error ? (
        <span className="stat-error">{error}</span>
      ) : (
        <span className="stat-value">{value === null ? '…' : card.format ? card.format(value) : value}</span>
      )}
    </>
  )

  return card.page && onNavigate ? (
    <Card as="button" type="button" className={`stat-card${warn ? ' warn' : ''}`} onClick={() => onNavigate(card.page)}>
      {body}
    </Card>
  ) : (
    <Card className="stat-card">{body}</Card>
  )
}
