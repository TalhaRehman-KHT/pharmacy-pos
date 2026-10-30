import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '../components/Button.jsx'
import Card from '../components/Card.jsx'
import EmptyState from '../components/EmptyState.jsx'
import Field from '../components/Field.jsx'
import Input from '../components/Input.jsx'
import MedicineSearch from '../components/MedicineSearch.jsx'
import Modal, { ModalActions } from '../components/Modal.jsx'
import Select from '../components/Select.jsx'
import Table from '../components/Table.jsx'
import Toast from '../components/Toast.jsx'
import { print as printApi, sales as salesApi } from '../lib/api.js'
import { expiryStatus, formatPKR } from '../lib/format.js'
import { useRowFlash } from '../lib/useRowFlash.js'
import './Billing.css'

const MONEY = /^\d+(\.\d{1,2})?$/

const PAYMENT_MODES = [
  ['cash', 'Cash'],
  ['card', 'Card'],
  ['split', 'Split'],
]

// Cart item: { medicineId, name, unit, qty, available, lines: [{ batch_id, batch_no, expiry_date, qty, sale_price }] }
// The lines are the FEFO split from allocate(); nothing is written until the sale is saved, and the
// main process re-checks stock and prices then.
export default function Billing() {
  const [cart, setCart] = useState([])
  const [error, setError] = useState('')
  const [discountMode, setDiscountMode] = useState('amount')
  const [discountInput, setDiscountInput] = useState('')
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  // Confirmed payment: { total, mode, tendered, cardAmount, reference, payments, cash, tenderedAmount, change }
  const [captured, setCaptured] = useState(null)
  const [saving, setSaving] = useState(false)
  // Set synchronously so a second F9 before the re-render cannot save the same cart twice
  const savingRef = useRef(false)
  const [lastSale, setLastSale] = useState(null)
  // Sellable stock per medicine id, filled lazily as search results appear
  const [stock, setStock] = useState({})
  const stockRequestedRef = useRef(new Set())
  const searchWrapRef = useRef(null)
  // medicineId -> { seq, qty } of the allocate() call in flight. Guards against an older reply
  // overwriting a newer one or re-adding a removed item, and lets rapid repeat scans count up.
  const requestSeqRef = useRef(0)
  const latestRequestRef = useRef(new Map())
  // Highlights the cart rows of the medicine just added or changed
  const [rowFlash, flashRow] = useRowFlash()

  const focusSearch = useCallback(() => {
    searchWrapRef.current?.querySelector('input')?.focus()
  }, [])

  const loadStock = useCallback((medicineId) => {
    if (stockRequestedRef.current.has(medicineId)) return
    stockRequestedRef.current.add(medicineId)
    salesApi
      .availableQty(medicineId)
      .then((qty) => setStock((s) => ({ ...s, [medicineId]: qty })))
      .catch(() => stockRequestedRef.current.delete(medicineId))
  }, [])

  // Resolves true when the cart now holds qty of this medicine, false when it was refused
  async function applyQty(medicine, qty) {
    const seq = ++requestSeqRef.current
    const isLatest = () => latestRequestRef.current.get(medicine.id)?.seq === seq
    latestRequestRef.current.set(medicine.id, { seq, qty })
    try {
      const result = await salesApi.allocate(medicine.id, qty)
      if (!isLatest()) return false
      latestRequestRef.current.delete(medicine.id)
      setStock((s) => ({ ...s, [medicine.id]: result.available }))

      if (!result.sufficient) {
        setError(
          result.available === 0
            ? `${medicine.name} is out of stock.`
            : `Only ${result.available} of ${medicine.name} available; cannot sell ${qty}.`,
        )
        return false
      }

      const item = {
        medicineId: medicine.id,
        name: medicine.name,
        unit: medicine.unit,
        qty,
        available: result.available,
        lines: result.lines,
      }
      setCart((c) =>
        c.some((i) => i.medicineId === medicine.id)
          ? c.map((i) => (i.medicineId === medicine.id ? item : i))
          : [...c, item],
      )
      flashRow(medicine.id)
      setError('')
      setLastSale(null)
      return true
    } catch (err) {
      if (isLatest()) {
        latestRequestRef.current.delete(medicine.id)
        setError(err.message)
      }
      return false
    }
  }

  // Picking a medicine already in the cart adds one more
  function addMedicine(medicine) {
    const current =
      latestRequestRef.current.get(medicine.id)?.qty ?? cart.find((i) => i.medicineId === medicine.id)?.qty ?? 0
    applyQty(medicine, current + 1)
  }

  function removeItem(medicineId) {
    latestRequestRef.current.delete(medicineId)
    setCart((c) => c.filter((i) => i.medicineId !== medicineId))
    focusSearch()
  }

  function clearCart() {
    latestRequestRef.current.clear()
    setCart([])
    setDiscountInput('')
    setCaptured(null)
    setError('')
    setConfirmingClear(false)
    focusSearch()
  }

  const totals = computeTotals(cart, discountMode, discountInput)
  // A payment confirmed for a different total no longer settles this bill
  const payment = captured && captured.total === totals.total ? captured : null

  // Reports why the bill cannot be paid yet, or returns true
  function readyForPayment() {
    if (cart.length === 0) {
      setError('The cart is empty.')
      return false
    }
    if (totals.discountError) {
      setError(totals.discountError)
      return false
    }
    if (latestRequestRef.current.size > 0) {
      setError('A quantity change is still being checked. Try again in a moment.')
      return false
    }
    return true
  }

  function openPayment() {
    if (readyForPayment()) setPaymentOpen(true)
  }

  function confirmPayment(confirmed, andSave) {
    const withTotal = { ...confirmed, total: totals.total }
    setCaptured(withTotal)
    setPaymentOpen(false)
    if (andSave) saveSale(withTotal)
    else focusSearch()
  }

  // On failure the cart, discount and payment stay as they were so the cashier can fix and retry
  async function saveSale(pay) {
    if (savingRef.current) return
    if (!pay) {
      openPayment()
      return
    }
    if (!readyForPayment()) return

    savingRef.current = true
    setSaving(true)
    try {
      const result = await salesApi.create(
        { total: totals.total, discount: totals.discount },
        cart.flatMap((item) =>
          item.lines.map((l) => ({ medicine_id: item.medicineId, batch_id: l.batch_id, qty: l.qty })),
        ),
        pay.payments,
      )

      setLastSale({
        id: result.id,
        invoiceNo: result.invoice_no,
        total: result.total,
        change: pay.cash > 0 ? pay.change : 0,
        print: { state: 'printing' },
      })
      // The sale is already committed; printing runs on without blocking the next bill, and a
      // printing failure is reported on the banner without undoing or repeating the sale
      printReceipt(result.id, false)
      latestRequestRef.current.clear()
      setCart([])
      setDiscountInput('')
      setCaptured(null)
      setError('')
      // Stock hints were cached before the sale; drop them so they are fetched again
      stockRequestedRef.current.clear()
      setStock({})
      focusSearch()
    } catch (err) {
      setError(err.message)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  // Updates the banner only while it still shows this sale, so a slow print cannot overwrite a newer one
  async function printReceipt(saleId, reprint) {
    const setPrint = (print) => setLastSale((prev) => (prev?.id === saleId ? { ...prev, print } : prev))
    setPrint({ state: 'printing' })
    try {
      const res = await (reprint ? printApi.reprint(saleId) : printApi.invoice(saleId))
      setPrint(res.printed ? { state: 'printed', printer: res.printer } : { state: 'pdf', pdfPath: res.pdfPath })
    } catch (err) {
      setPrint({ state: 'failed', error: err.message })
    }
  }

  // Registered on window so it runs after React's handlers; an Escape a field already used
  // (clearing the search text, reverting a quantity) arrives with defaultPrevented set.
  // No dependency list: the handler calls functions that close over the current cart and totals.
  useEffect(() => {
    function onKeyDown(e) {
      // The payment dialogue handles its own keys
      if (paymentOpen) return
      if (e.key === 'F1') {
        e.preventDefault()
        if (confirmingClear) return
        focusSearch()
      } else if (e.key === 'F2') {
        e.preventDefault()
        if (confirmingClear || saving) return
        openPayment()
      } else if (e.key === 'F9') {
        e.preventDefault()
        if (confirmingClear) return
        saveSale(payment)
      } else if (e.key === 'Escape') {
        if (e.defaultPrevented || saving) return
        if (confirmingClear) {
          e.preventDefault()
          setConfirmingClear(false)
          focusSearch()
        } else if (cart.length > 0) {
          e.preventDefault()
          setConfirmingClear(true)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className="billing">
      <header className="page-header">
        <h1>Billing</h1>
        <span className="key-hints">
          <kbd>F1</kbd> search <kbd>F2</kbd> payment <kbd>F9</kbd> save <kbd>Esc</kbd> clear cart
        </span>
      </header>

      {error && (
        <Toast tone="error" onDismiss={() => setError('')}>
          {error}
        </Toast>
      )}

      {lastSale && (
        <Toast tone={lastSale.print.state === 'failed' ? 'warning' : 'success'}>
          Sale saved. Invoice <strong className="mono">{lastSale.invoiceNo}</strong> · {formatPKR(lastSale.total)}
          {lastSale.change > 0 && (
            <>
              {' '}
              · Change due <strong>{formatPKR(lastSale.change)}</strong>
            </>
          )}
          <span className="sale-print-note">
            {lastSale.print.state === 'printing' && 'Printing receipt…'}
            {lastSale.print.state === 'printed' && `Receipt sent to ${lastSale.print.printer}.`}
            {lastSale.print.state === 'pdf' && `No printer configured; receipt saved as ${lastSale.print.pdfPath}`}
            {lastSale.print.state === 'failed' && `Receipt not printed: ${lastSale.print.error}`}{' '}
            {lastSale.print.state !== 'printing' && (
              <Button size="small" onClick={() => printReceipt(lastSale.id, true)}>
                Reprint
              </Button>
            )}
          </span>
        </Toast>
      )}

      <Card ref={searchWrapRef}>
        <MedicineSearch
          autoFocus
          onSelect={addMedicine}
          renderResultExtra={(m) => (
            <StockHint
              medicineId={m.id}
              available={stock[m.id]}
              inCart={cart.find((i) => i.medicineId === m.id)?.qty ?? 0}
              onNeed={loadStock}
            />
          )}
        />
      </Card>

      <section className="cart">
        {cart.length === 0 ? (
          <EmptyState>Cart is empty. Search for a medicine and press Enter to add it.</EmptyState>
        ) : (
          <Table className="cart-table">
            <thead>
              <tr>
                <th>Medicine</th>
                <th>Batch</th>
                <th className="num">Quantity</th>
                <th className="num">Rate</th>
                <th className="num">Line total</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {cart.map((item) =>
                item.lines.map((line, i) => {
                  const span = item.lines.length
                  return (
                    <tr
                      key={`${item.medicineId}-${line.batch_id}`}
                      className={[i === 0 && 'item-start', rowFlash(item.medicineId)].filter(Boolean).join(' ') || undefined}
                    >
                      {i === 0 && (
                        <td rowSpan={span} className="cart-name">
                          {item.name}
                          {item.unit && <span className="muted"> · {item.unit}</span>}
                        </td>
                      )}
                      <td>
                        <span className="mono">{line.batch_no || '—'}</span>
                        {line.expiry_date && (
                          <span className={`cart-expiry expiry-${expiryStatus(line.expiry_date) ?? 'ok'}`}>
                            exp {line.expiry_date}
                          </span>
                        )}
                        {span > 1 && <span className="cart-split">× {line.qty}</span>}
                      </td>
                      {i === 0 && (
                        <td rowSpan={span} className="num">
                          <QtyInput
                            qty={item.qty}
                            available={item.available}
                            label={`Quantity of ${item.name}`}
                            onCommit={(qty) => applyQty({ id: item.medicineId, name: item.name, unit: item.unit }, qty)}
                            onDone={focusSearch}
                          />
                        </td>
                      )}
                      <td className="num">{formatPKR(line.sale_price)}</td>
                      <td className="num">{formatPKR(lineTotal(line))}</td>
                      {i === 0 && (
                        <td rowSpan={span} className="cart-actions">
                          <Button variant="danger" size="small" onClick={() => removeItem(item.medicineId)}>
                            Remove
                          </Button>
                        </td>
                      )}
                    </tr>
                  )
                }),
              )}
            </tbody>
          </Table>
        )}
      </section>

      <Card as="section" className="bill-summary">
        <div className="summary-row">
          <span>Subtotal</span>
          <span className="num">{formatPKR(totals.subtotal)}</span>
        </div>

        <div className="summary-row discount-row">
          <label className="discount-control">
            <span>Discount</span>
            <Select value={discountMode} onChange={(e) => setDiscountMode(e.target.value)}>
              <option value="amount">PKR</option>
              <option value="percent">%</option>
            </Select>
            <Input
              value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              align="right"
              invalid={!!totals.discountError}
            />
          </label>
          <span className="num">− {formatPKR(totals.discount)}</span>
        </div>
        {totals.discountError && <div className="field-error">{totals.discountError}</div>}

        <div className="summary-row summary-total">
          <span>Total</span>
          <span className="num">{formatPKR(totals.total)}</span>
        </div>

        {payment && (
          <div className="payment-summary">
            {payment.payments.map((p) => (
              <div className="summary-row" key={p.method}>
                <span>
                  {p.method === 'cash' ? 'Cash' : 'Card'}
                  {p.reference && <span className="muted mono"> · {p.reference}</span>}
                </span>
                <span className="num">{formatPKR(p.amount)}</span>
              </div>
            ))}
            {payment.cash > 0 && (
              <div className="summary-row payment-change">
                <span>Tendered {formatPKR(payment.tenderedAmount)}</span>
                <span>Change {formatPKR(payment.change)}</span>
              </div>
            )}
          </div>
        )}

        <div className="form-actions">
          <Button onClick={openPayment} disabled={saving || cart.length === 0}>
            {payment ? 'Change payment' : 'Payment'} (F2)
          </Button>
          <Button variant="primary" onClick={() => saveSale(payment)} disabled={!payment} loading={saving}>
            {saving ? 'Saving…' : 'Save sale (F9)'}
          </Button>
        </div>
      </Card>

      {paymentOpen && (
        <PaymentDialog
          total={totals.total}
          initial={payment}
          onCancel={() => {
            setPaymentOpen(false)
            focusSearch()
          }}
          onConfirm={confirmPayment}
        />
      )}

      {/* Escape is handled by the page's key handler above, so no onEscape here */}
      {confirmingClear && (
        <Modal
          title="Clear the cart?"
          role="alertdialog"
          size="sm"
          tone="danger"
          onBackdrop={() => setConfirmingClear(false)}
        >
          <p>
            This removes all {cart.length} item{cart.length === 1 ? '' : 's'} and the discount.
          </p>
          <ModalActions>
            <Button
              onClick={() => {
                setConfirmingClear(false)
                focusSearch()
              }}
            >
              Keep items
            </Button>
            <Button variant="danger-solid" autoFocus onClick={clearCart}>
              Clear cart
            </Button>
          </ModalActions>
        </Modal>
      )}
    </div>
  )
}

// Enter confirms, F9 confirms and saves, Esc cancels. Confirm stays disabled until the payments
// add up to the total; an empty tendered amount means the customer paid the cash part exactly.
function PaymentDialog({ total, initial, onCancel, onConfirm }) {
  const [mode, setMode] = useState(initial?.mode ?? 'cash')
  const [tendered, setTendered] = useState(initial?.tendered ?? '')
  const [cardAmount, setCardAmount] = useState(initial?.cardAmount ?? '')
  const [reference, setReference] = useState(initial?.reference ?? '')
  // Missing-value errors wait for a confirm attempt; malformed values are flagged while typing
  const [attempted, setAttempted] = useState(false)

  const p = computePayment(total, { mode, tendered, cardAmount, reference })
  const shown = (field, text) => (attempted || text.trim() !== '' ? p.errors[field] : undefined)

  function confirm(andSave) {
    setAttempted(true)
    if (!p.valid) return
    onConfirm(
      {
        mode,
        tendered,
        cardAmount,
        reference,
        payments: p.payments,
        cash: p.cash,
        tenderedAmount: p.tenderedAmount,
        change: p.change,
      },
      andSave,
    )
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (e.key === 'F9') {
      e.preventDefault()
      confirm(true)
    } else if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault()
      confirm(false)
    } else if (e.key === 'F1' || e.key === 'F2') {
      e.preventDefault()
    }
  }

  return (
    <Modal title="Payment" size="sm" className="payment-modal" onBackdrop={onCancel} onKeyDown={onKeyDown}>
      <div className="pay-due">
        <span>Total due</span>
        <strong>{formatPKR(total)}</strong>
      </div>

      <div className="pay-modes" role="group" aria-label="Payment method">
        {PAYMENT_MODES.map(([value, label]) => (
          <Button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>
            {label}
          </Button>
        ))}
      </div>

      <div className="pay-fields">
        {mode === 'split' && (
          <Field label="Card amount" error={shown('cardAmount', cardAmount)}>
            <Input
              key="split-card"
              autoFocus
              value={cardAmount}
              onChange={(e) => setCardAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              size="large"
              align="right"
            />
          </Field>
        )}

        {mode !== 'cash' && (
          <Field label="Card slip reference" error={shown('reference', reference)}>
            <Input
              key={`${mode}-ref`}
              autoFocus={mode === 'card'}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              size="large"
              mono
            />
          </Field>
        )}

        {mode !== 'card' && (
          <>
            {mode === 'split' && (
              <div className="summary-row">
                <span>Cash due</span>
                <span className="num">{formatPKR(p.cash)}</span>
              </div>
            )}
            <Field label="Cash tendered" error={shown('tendered', tendered)}>
              <Input
                key={`${mode}-tendered`}
                autoFocus={mode === 'cash'}
                value={tendered}
                onChange={(e) => setTendered(e.target.value)}
                inputMode="decimal"
                placeholder={p.cash.toFixed(2)}
                size="large"
                align="right"
              />
            </Field>
            <div className="summary-row pay-change">
              <span>Change</span>
              <span className="num">{formatPKR(p.change)}</span>
            </div>
          </>
        )}
      </div>

      {attempted && p.errors.total && <div className="field-error">{p.errors.total}</div>}

      <ModalActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button disabled={!p.valid} onClick={() => confirm(false)}>
          Confirm (Enter)
        </Button>
        <Button variant="primary" disabled={!p.valid} onClick={() => confirm(true)}>
          Confirm and save (F9)
        </Button>
      </ModalActions>
    </Modal>
  )
}

// payments holds only non-zero parts; cash is the amount kept, so change is never recorded as paid
function computePayment(total, { mode, tendered, cardAmount, reference }) {
  const errors = {}

  let card = 0
  if (mode === 'card') {
    card = total
  } else if (mode === 'split') {
    const text = cardAmount.trim()
    if (!MONEY.test(text)) errors.cardAmount = 'Enter the card amount, like 500 or 499.50.'
    else if (Number(text) <= 0 || Number(text) >= total) {
      errors.cardAmount = `Card amount must be above 0 and below ${formatPKR(total)}.`
    } else card = Number(text)
  }
  const cash = round2(total - card)

  const ref = reference.trim()
  if (card > 0 && !ref) errors.reference = 'Enter the card slip reference.'

  let tenderedAmount = cash
  const tenderedText = tendered.trim()
  if (cash > 0 && tenderedText) {
    if (!MONEY.test(tenderedText)) errors.tendered = 'Enter an amount like 1000 or 999.50.'
    else if (Number(tenderedText) < cash) errors.tendered = `Less than the ${formatPKR(cash)} due in cash.`
    else tenderedAmount = Number(tenderedText)
  }
  const change = errors.tendered ? 0 : round2(tenderedAmount - cash)

  const payments = []
  if (cash > 0) payments.push({ method: 'cash', amount: cash, tendered: tenderedAmount })
  if (card > 0) payments.push({ method: 'card', amount: card, reference: ref })
  if (round2(payments.reduce((sum, p) => sum + p.amount, 0)) !== total) {
    errors.total = 'The payments do not add up to the sale total.'
  }

  return { payments, cash, tenderedAmount, change, errors, valid: Object.keys(errors).length === 0 }
}

function StockHint({ medicineId, available, inCart, onNeed }) {
  useEffect(() => {
    if (available === undefined) onNeed(medicineId)
  }, [medicineId, available, onNeed])

  if (available === undefined) return <span className="ms-stock">…</span>
  return (
    <span className={`ms-stock${available === 0 ? ' out' : ''}`}>
      {available === 0 ? 'Out of stock' : `${available} in stock`}
      {inCart > 0 && ` · ${inCart} in cart`}
    </span>
  )
}

// Keeps a draft while typing; commits on Enter or blur and reverts if the new quantity is refused
function QtyInput({ qty, available, label, onCommit, onDone }) {
  const [draft, setDraft] = useState(String(qty))

  useEffect(() => {
    setDraft(String(qty))
  }, [qty])

  async function commit() {
    const text = draft.trim()
    if (!/^\d+$/.test(text) || Number(text) <= 0 || Number(text) === qty) {
      setDraft(String(qty))
      return
    }
    const ok = await onCommit(Number(text))
    if (!ok) setDraft(String(qty))
  }

  return (
    <span className="qty-cell">
      <Input
        className="qty-input"
        size="large"
        align="right"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            // Moving focus blurs the field, which commits it
            onDone()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setDraft(String(qty))
          }
        }}
        inputMode="numeric"
        aria-label={label}
      />
      <span className="qty-available">of {available}</span>
    </span>
  )
}

function round2(n) {
  return Math.round(n * 100) / 100
}

function lineTotal(line) {
  return round2(line.qty * line.sale_price)
}

// An invalid discount is reported and not applied, so the total shown is never based on a bad value
function computeTotals(cart, mode, input) {
  const subtotal = round2(cart.reduce((sum, item) => sum + item.lines.reduce((s, l) => s + lineTotal(l), 0), 0))

  const text = input.trim()
  let discount = 0
  let discountError = ''
  if (text) {
    if (!MONEY.test(text)) {
      discountError = mode === 'percent' ? 'Enter a percentage like 5 or 2.5.' : 'Enter an amount like 50 or 50.25.'
    } else if (mode === 'percent') {
      const pct = Number(text)
      if (pct > 100) discountError = 'Percentage cannot exceed 100.'
      else discount = round2((subtotal * pct) / 100)
    } else {
      const amount = Number(text)
      if (amount > subtotal) discountError = `Discount cannot exceed the subtotal (${formatPKR(subtotal)}).`
      else discount = amount
    }
  }

  return { subtotal, discount, discountError, total: round2(subtotal - discount) }
}
