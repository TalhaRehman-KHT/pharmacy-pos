import { useEffect, useState } from 'react'
import Button from '../components/Button.jsx'
import Card from '../components/Card.jsx'
import EmptyState from '../components/EmptyState.jsx'
import Field from '../components/Field.jsx'
import Input from '../components/Input.jsx'
import Table from '../components/Table.jsx'
import Toast from '../components/Toast.jsx'
import { reports } from '../lib/api.js'
import { formatPKR } from '../lib/format.js'
import './Reports.css'

const TOP_LIMIT = 10

// Owner only: hidden from a salesman in App.jsx and rejected for one by the main process
export default function Reports() {
  const [range, setRange] = useState(() => presetRange('today'))
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [exportState, setExportState] = useState(null)

  const { from, to } = range
  const rangeError = !from || !to ? 'Choose both dates.' : from > to ? 'The start date is after the end date.' : ''

  useEffect(() => {
    if (rangeError) return
    let cancelled = false
    setError('')
    setReport(null)
    Promise.all([
      reports.salesSummary({ from, to }),
      reports.grossMargin({ from, to }),
      reports.dailyTotals({ from, to }),
      reports.topSelling({ from, to, limit: TOP_LIMIT }),
    ])
      .then(([summary, margin, days, top]) => !cancelled && setReport({ summary, margin, days, top }))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [from, to, rangeError, reloadKey])

  const setDate = (key) => (e) => setRange((r) => ({ ...r, [key]: e.target.value }))

  // The main process rebuilds the same report from the same range, so the file matches what is on screen
  async function exportCsv() {
    setExportState({ state: 'saving' })
    try {
      const res = await reports.exportCsv({ from, to, limit: TOP_LIMIT })
      setExportState(res.saved ? { state: 'saved', filePath: res.filePath } : null)
    } catch (err) {
      setExportState({ state: 'failed', error: err.message })
    }
  }

  const activePreset = ['today', 'week', 'month'].find((p) => {
    const r = presetRange(p)
    return r.from === from && r.to === to
  })

  return (
    <div className="report-page">
      <header className="page-header">
        <h1>Reports</h1>
        <div className="header-actions">
          <Button onClick={() => setReloadKey((k) => k + 1)}>Refresh</Button>
          <Button variant="primary" disabled={!report} loading={exportState?.state === 'saving'} onClick={exportCsv}>
            Export CSV
          </Button>
        </div>
      </header>

      <div className="date-range">
        <Field label="From">
          <Input type="date" value={from} max={to || undefined} onChange={setDate('from')} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} min={from || undefined} onChange={setDate('to')} />
        </Field>
        {[
          ['today', 'Today'],
          ['week', 'This week'],
          ['month', 'This month'],
        ].map(([id, label]) => (
          <Button key={id} aria-pressed={activePreset === id} onClick={() => setRange(presetRange(id))}>
            {label}
          </Button>
        ))}
      </div>

      {exportState && (
        <Toast
          tone={exportState.state === 'failed' ? 'error' : exportState.state === 'saving' ? 'info' : 'success'}
          onDismiss={exportState.state === 'saving' ? undefined : () => setExportState(null)}
        >
          {exportState.state === 'saving' && 'Exporting…'}
          {exportState.state === 'saved' && `Report saved as ${exportState.filePath}`}
          {exportState.state === 'failed' && `Export failed: ${exportState.error}`}
        </Toast>
      )}

      {(rangeError || error) && <Toast tone="error">{rangeError || error}</Toast>}

      {rangeError ? null : !report ? (
        !error && <p className="muted">Loading...</p>
      ) : (
        <>
          <SummaryCards summary={report.summary} margin={report.margin} />

          <section className="report-section">
            <h2 className="section-title">
              Daily sales
              <span className="section-summary">Completed sales, PKR</span>
            </h2>
            <BarChart days={report.days} />
          </section>

          <div className="top-grid">
            <TopTable title="Top selling by quantity" rows={report.top.byQuantity} />
            <TopTable title="Top selling by value" rows={report.top.byValue} />
          </div>
        </>
      )}
    </div>
  )
}

function SummaryCards({ summary, margin }) {
  return (
    <>
      <div className="stat-grid">
        <Stat label="Total sales" value={formatPKR(summary.total_sales)} />
        <Stat label="Bills" value={summary.bill_count} />
        <Stat label="Average bill" value={formatPKR(summary.average_bill)} />
        <Stat label="Cash" value={formatPKR(summary.cash)} />
        <Stat label="Card" value={formatPKR(summary.card)} />
        {summary.other > 0 && <Stat label="Other payments" value={formatPKR(summary.other)} />}
        <Stat
          label={margin.margin_pct === null ? 'Gross margin' : `Gross margin (${margin.margin_pct}%)`}
          value={formatPKR(margin.margin)}
        />
      </div>
      <p className="muted margin-note">
        Margin is sales after discount less the purchase price of the batch each item was sold from.
        {margin.unattributed_lines > 0 &&
          ` ${margin.unattributed_lines} sold line${margin.unattributed_lines === 1 ? '' : 's'} (${formatPKR(margin.unattributed_sales)}) ` +
            'had no batch recorded and are left out of the margin.'}
        {margin.zero_cost_lines > 0 &&
          ` ${margin.zero_cost_lines} line${margin.zero_cost_lines === 1 ? '' : 's'} (${formatPKR(margin.zero_cost_sales)}) ` +
            'came from batches with no purchase price, which overstates the margin.'}
      </p>
    </>
  )
}

function Stat({ label, value }) {
  return (
    <Card className="stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </Card>
  )
}

// A plain SVG bar chart: one bar per day, scaled to the busiest day, with a hover tooltip per bar
function BarChart({ days }) {
  const W = 800
  const H = 220
  const PAD = { top: 16, right: 8, bottom: 24, left: 8 }
  const max = Math.max(0, ...days.map((d) => d.total))
  const slot = (W - PAD.left - PAD.right) / days.length
  const barW = Math.max(1, slot - 2)
  const plotH = H - PAD.top - PAD.bottom
  const labelEvery = Math.ceil(days.length / 10)

  return (
    <svg className="bar-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily sales totals">
      <text x={PAD.left} y={PAD.top - 4} className="chart-axis">
        {max > 0 ? `Highest day: ${formatPKR(max)}` : 'No sales in this period'}
      </text>
      {days.map((d, i) => {
        const h = max > 0 ? (d.total / max) * plotH : 0
        const x = PAD.left + i * slot + (slot - barW) / 2
        return (
          <g key={d.date}>
            <rect x={x} y={H - PAD.bottom - h} width={barW} height={h} rx={Math.min(4, barW / 2)} className="chart-bar">
              <title>{`${d.date}: ${formatPKR(d.total)} (${d.bill_count} bill${d.bill_count === 1 ? '' : 's'})`}</title>
            </rect>
            {i % labelEvery === 0 && (
              <text x={x + barW / 2} y={H - 6} textAnchor="middle" className="chart-axis">
                {d.date.slice(5)}
              </text>
            )}
          </g>
        )
      })}
      <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} className="chart-baseline" />
    </svg>
  )
}

function TopTable({ title, rows }) {
  return (
    <section className="report-section">
      <h2 className="section-title">{title}</h2>
      {rows.length === 0 ? (
        <EmptyState>No sales in this period.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Medicine</th>
              <th className="num">Quantity</th>
              <th className="num">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.medicine_id}>
                <td>{r.name}</td>
                <td className="num">
                  {r.quantity} <span className="muted">{r.unit}</span>
                </td>
                <td className="num">{formatPKR(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  )
}

// Local calendar ranges ending today; the week starts on Monday
function presetRange(preset) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (preset === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  if (preset === 'month') start.setDate(1)
  return { from: toDateOnly(start), to: toDateOnly(now) }
}

function toDateOnly(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
