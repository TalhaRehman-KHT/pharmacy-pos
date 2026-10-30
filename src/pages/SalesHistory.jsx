import { useEffect, useState } from 'react'
import Badge from '../components/Badge.jsx'
import Button from '../components/Button.jsx'
import EmptyState from '../components/EmptyState.jsx'
import Field from '../components/Field.jsx'
import Input from '../components/Input.jsx'
import Modal, { ModalActions } from '../components/Modal.jsx'
import Table from '../components/Table.jsx'
import Toast from '../components/Toast.jsx'
import { print as printApi, reports } from '../lib/api.js'
import { formatPKR } from '../lib/format.js'
import './Reports.css'

export default function SalesHistory() {
  const [range, setRange] = useState(() => ({ from: todayLocal(), to: todayLocal() }))
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [openSaleId, setOpenSaleId] = useState(null)

  const { from, to } = range
  const rangeError = !from || !to ? 'Choose both dates.' : from > to ? 'The start date is after the end date.' : ''

  useEffect(() => {
    if (rangeError) return
    let cancelled = false
    setError('')
    reports
      .salesHistory({ from, to })
      .then((data) => !cancelled && setRows(data))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [from, to, rangeError, reloadKey])

  const setDate = (key) => (e) => setRange((r) => ({ ...r, [key]: e.target.value }))
  const completed = (rows ?? []).filter((r) => r.status === 'completed')
  const total = completed.reduce((sum, r) => sum + r.total, 0)

  return (
    <div className="report-page">
      <header className="page-header">
        <h1>Sales History</h1>
        <Button onClick={() => setReloadKey((k) => k + 1)}>Refresh</Button>
      </header>

      <div className="date-range">
        <Field label="From">
          <Input type="date" value={from} max={to || undefined} onChange={setDate('from')} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} min={from || undefined} onChange={setDate('to')} />
        </Field>
        <Button onClick={() => setRange({ from: todayLocal(), to: todayLocal() })}>Today</Button>
        {rows && !rangeError && (
          <span className="range-summary">
            {completed.length} bill{completed.length === 1 ? '' : 's'} · {formatPKR(total)}
          </span>
        )}
      </div>

      {(rangeError || error) && <Toast tone="error">{rangeError || error}</Toast>}

      {rangeError ? null : rows === null ? (
        !error && <p className="muted">Loading...</p>
      ) : rows.length === 0 ? (
        <EmptyState>No sales in this period.</EmptyState>
      ) : (
        <Table clickable>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Date &amp; time</th>
              <th className="num">Items</th>
              <th>Payment</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                tabIndex={0}
                onClick={() => setOpenSaleId(r.id)}
                onKeyDown={(e) => e.key === 'Enter' && setOpenSaleId(r.id)}
              >
                <td className="mono">
                  {r.invoice_no}
                  {r.status !== 'completed' && <Badge tone="warning">{r.status}</Badge>}
                </td>
                <td>{formatLocalDateTime(r.created_at)}</td>
                <td className="num">{r.item_count}</td>
                <td className="capitalize">{r.payment_methods}</td>
                <td className="num">{formatPKR(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {openSaleId !== null && <SaleDetail saleId={openSaleId} onClose={() => setOpenSaleId(null)} />}
    </div>
  )
}

function SaleDetail({ saleId, onClose }) {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  const [printState, setPrintState] = useState(null)

  useEffect(() => {
    let cancelled = false
    reports
      .saleDetail(saleId)
      .then((data) => !cancelled && setDetail(data))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [saleId])

  // The Phase 6 reprint path: the same invoice template the original receipt used, marked as a copy
  async function reprint() {
    setPrintState({ state: 'printing' })
    try {
      const res = await printApi.reprint(saleId)
      setPrintState(res.printed ? { state: 'printed', printer: res.printer } : { state: 'pdf', pdfPath: res.pdfPath })
    } catch (err) {
      setPrintState({ state: 'failed', error: err.message })
    }
  }

  const sale = detail?.sale

  return (
    <Modal size="lg" aria-label="Sale detail" onBackdrop={onClose} onEscape={onClose}>
      {error && <Toast tone="error">{error}</Toast>}
      {!detail && !error && <p className="muted">Loading...</p>}

      {printState && (
        <Toast tone={printState.state === 'failed' ? 'error' : printState.state === 'printing' ? 'info' : 'success'}>
          {printState.state === 'printing' && 'Printing copy…'}
          {printState.state === 'printed' && `Copy sent to ${printState.printer}.`}
          {printState.state === 'pdf' && `No printer configured; copy saved as ${printState.pdfPath}`}
          {printState.state === 'failed' && `Copy not printed: ${printState.error}`}
        </Toast>
      )}

      {sale && (
        <>
          <header className="detail-header">
            <div>
              <h2 className="mono">{sale.invoice_no}</h2>
              <span className="muted">
                {formatLocalDateTime(sale.created_at)}
                {sale.operator_name && ` · ${sale.operator_name}`}
              </span>
            </div>
            {sale.status !== 'completed' && <Badge tone="warning">{sale.status}</Badge>}
          </header>

          {(sale.customer_name || sale.customer_phone || sale.doctor_name) && (
            <dl className="detail-meta">
              {sale.customer_name && <Meta label="Customer" value={sale.customer_name} />}
              {sale.customer_phone && <Meta label="Phone" value={sale.customer_phone} />}
              {sale.doctor_name && <Meta label="Doctor" value={sale.doctor_name} />}
            </dl>
          )}

          <Table>
            <thead>
              <tr>
                <th>Medicine</th>
                <th>Batch</th>
                <th className="num">Qty</th>
                <th className="num">Price</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((item, i) => (
                <tr key={i}>
                  <td>{item.medicine_name}</td>
                  <td className="mono">{item.batch_no}</td>
                  <td className="num">{item.qty}</td>
                  <td className="num">{formatPKR(item.unit_price)}</td>
                  <td className="num">{formatPKR(item.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </Table>

          <dl className="detail-totals">
            <Meta label="Subtotal" value={formatPKR(sale.subtotal)} />
            {sale.discount > 0 && <Meta label="Discount" value={`− ${formatPKR(sale.discount)}`} />}
            {sale.tax > 0 && <Meta label="Tax" value={formatPKR(sale.tax)} />}
            <Meta label="Total" value={formatPKR(sale.total)} strong />
            {detail.payments.map((p, i) => (
              <PaymentLines key={i} payment={p} />
            ))}
          </dl>
        </>
      )}

      <ModalActions>
        <Button onClick={onClose}>Close</Button>
        {sale && (
          <Button variant="primary" loading={printState?.state === 'printing'} onClick={reprint}>
            Reprint
          </Button>
        )}
      </ModalActions>
    </Modal>
  )
}

function PaymentLines({ payment }) {
  const label = payment.method === 'card' ? `Card (${payment.reference})` : 'Cash'
  return (
    <>
      <Meta label={label} value={formatPKR(payment.amount)} />
      {payment.tendered != null && (
        <>
          <Meta label="Tendered" value={formatPKR(payment.tendered)} muted />
          <Meta label="Change" value={formatPKR(payment.change)} muted />
        </>
      )}
    </>
  )
}

function Meta({ label, value, strong, muted }) {
  return (
    <div className={`meta-row${strong ? ' strong' : ''}${muted ? ' muted' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function todayLocal() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function formatLocalDateTime(iso) {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''
}
