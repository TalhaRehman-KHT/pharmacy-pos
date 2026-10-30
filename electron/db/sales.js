import { db, getSetting } from './index.js'
import { clean, round2, toId, toMoney, todayLocal } from './validate.js'

// Statements are prepared at load, so this module must be imported after initDb() has run

const PAYMENT_METHODS = ['cash', 'card']
const DEFAULT_INVOICE_PREFIX = 'INV'

// Sellable = in stock and not past expiry. Expiry is a calendar date, so a batch is sellable through
// its expiry day. FEFO order: earliest expiry first, undated batches last, oldest batch breaks ties.
const sellableStmt = db.prepare(`
  SELECT id, batch_no, sale_price, quantity, expiry_date
  FROM batches
  WHERE medicine_id = @medicineId
    AND quantity > 0
    AND (expiry_date IS NULL OR expiry_date >= @today)
  ORDER BY expiry_date IS NULL, expiry_date, id
`)

const availableStmt = db.prepare(`
  SELECT COALESCE(SUM(quantity), 0) AS available
  FROM batches
  WHERE medicine_id = @medicineId
    AND quantity > 0
    AND (expiry_date IS NULL OR expiry_date >= @today)
`)

const medicineStmt = db.prepare('SELECT id, is_active FROM medicines WHERE id = ?')

const batchForSaleStmt = db.prepare(`
  SELECT b.id, b.medicine_id, b.sale_price, b.quantity, b.expiry_date, m.name, m.is_active
  FROM batches b
  JOIN medicines m ON m.id = b.medicine_id
  WHERE b.id = ?
`)

// Every invoice_no in [@from, @to) starts with the day's stem: '.' sorts directly after the stem's
// trailing '-'. A range rather than LIKE so the UNIQUE index on invoice_no is used.
const lastSeqStmt = db.prepare(`
  SELECT MAX(CAST(substr(invoice_no, length(@from) + 1) AS INTEGER)) AS seq
  FROM sales
  WHERE invoice_no >= @from AND invoice_no < @to
`)

const insertSaleStmt = db.prepare(`
  INSERT INTO sales (invoice_no, subtotal, discount, tax, total, status,
                     customer_name, customer_phone, doctor_name, user_id, created_at)
  VALUES (@invoice_no, @subtotal, @discount, 0, @total, 'completed',
          @customer_name, @customer_phone, @doctor_name, @user_id, @created_at)
`)

const insertItemStmt = db.prepare(`
  INSERT INTO sale_items (sale_id, medicine_id, batch_id, medicine_name, qty, unit_price, line_total)
  VALUES (@sale_id, @medicine_id, @batch_id, @medicine_name, @qty, @unit_price, @line_total)
`)

const insertPaymentStmt = db.prepare(`
  INSERT INTO payments (sale_id, method, amount, reference, tendered, created_at)
  VALUES (@sale_id, @method, @amount, @reference, @tendered, @created_at)
`)

const saleForPrintStmt = db.prepare(`
  SELECT s.id, s.invoice_no, s.subtotal, s.discount, s.tax, s.total, s.status,
         s.customer_name, s.customer_phone, s.doctor_name, s.created_at,
         COALESCE(u.full_name, u.username) AS operator_name
  FROM sales s
  LEFT JOIN users u ON u.id = s.user_id
  WHERE s.id = ?
`)

const itemsForPrintStmt = db.prepare(`
  SELECT i.medicine_name, b.batch_no, i.qty, i.unit_price, i.line_total
  FROM sale_items i
  LEFT JOIN batches b ON b.id = i.batch_id
  WHERE i.sale_id = ?
  ORDER BY i.id
`)

const paymentsForPrintStmt = db.prepare(`
  SELECT method, amount, reference, tendered
  FROM payments
  WHERE sale_id = ?
  ORDER BY id
`)

const INVOICE_SETTING_DEFAULTS = {
  shop_name: 'Pharmacy',
  shop_address: '',
  shop_phone: '',
  licence_no: '',
  invoice_footer: '',
  printer_name: '',
  invoice_layout: 'thermal',
}

const invoiceSettingsStmt = db.prepare(
  `SELECT key, value FROM settings WHERE key IN (${Object.keys(INVOICE_SETTING_DEFAULTS).map(() => '?').join(', ')})`,
)

// The quantity guard makes the decrement itself refuse to go negative, independent of the read above it
const decrementStmt = db.prepare('UPDATE batches SET quantity = quantity - @qty WHERE id = @id AND quantity >= @qty')

const insertSaleEntryStmt = db.prepare(`
  INSERT INTO stock_entries (batch_id, qty_change, reason, sale_id, note, user_id, created_at)
  VALUES (@batch_id, @qty_change, 'sale', @sale_id, NULL, @user_id, @created_at)
`)

// Stock, prices and totals are re-read and recomputed here, inside the transaction; the renderer's
// figures are only checked against them. Any throw rolls back every write below.
const createSaleTx = db.transaction((sale, items, payments, userId) => {
  const createdAt = new Date().toISOString()
  const today = todayLocal()

  const lines = items.map((item) => {
    const batch = batchForSaleStmt.get(item.batch_id)
    if (!batch || batch.medicine_id !== item.medicine_id) throw new Error('Batch not found for this medicine.')
    if (!batch.is_active) throw new Error(`${batch.name} is inactive and cannot be sold.`)
    if (batch.expiry_date !== null && batch.expiry_date < today) throw new Error(`Batch has expired: ${batch.name}`)
    if (batch.quantity < item.qty) throw new Error(`Insufficient stock: ${batch.name}`)
    return {
      medicine_id: batch.medicine_id,
      batch_id: batch.id,
      medicine_name: batch.name,
      qty: item.qty,
      unit_price: batch.sale_price,
      line_total: round2(item.qty * batch.sale_price),
    }
  })

  const subtotal = round2(lines.reduce((sum, l) => sum + l.line_total, 0))
  if (sale.discount > subtotal) throw new Error('Discount cannot exceed the subtotal.')
  const total = round2(subtotal - sale.discount)

  if (Math.abs(round2(total - sale.total)) > 0.01) {
    throw new Error(
      `The bill total no longer matches current prices (now ${total.toFixed(2)}). Remove and re-add the items.`,
    )
  }
  const paid = round2(payments.reduce((sum, p) => sum + p.amount, 0))
  if (Math.abs(round2(paid - total)) > 0.01) {
    throw new Error(`Payments (${paid.toFixed(2)}) do not equal the sale total (${total.toFixed(2)}).`)
  }

  const invoiceNo = nextInvoiceNo()
  const saleId = insertSaleStmt.run({
    invoice_no: invoiceNo,
    subtotal,
    discount: sale.discount,
    total,
    customer_name: sale.customer_name,
    customer_phone: sale.customer_phone,
    doctor_name: sale.doctor_name,
    user_id: userId,
    created_at: createdAt,
  }).lastInsertRowid

  for (const line of lines) {
    insertItemStmt.run({ ...line, sale_id: saleId })
    // Zero changes means an earlier line in this sale already took the stock (same batch twice)
    if (decrementStmt.run({ id: line.batch_id, qty: line.qty }).changes !== 1) {
      throw new Error(`Insufficient stock: ${line.medicine_name}`)
    }
    insertSaleEntryStmt.run({
      batch_id: line.batch_id,
      qty_change: -line.qty,
      sale_id: saleId,
      user_id: userId,
      created_at: createdAt,
    })
  }

  for (const p of payments) {
    insertPaymentStmt.run({ ...p, sale_id: saleId, created_at: createdAt })
  }

  return { id: saleId, invoice_no: invoiceNo, subtotal, discount: sale.discount, total, created_at: createdAt }
})

// Read-only: the split is a proposal for the cart; nothing is reserved or written.
// lines is empty when qty exceeds what is available, so a partial allocation never reaches the cart.
export function allocate(medicineId, qty) {
  const id = toId(medicineId, 'medicine')
  const wanted = Number(qty)
  if (!Number.isInteger(wanted) || wanted <= 0) throw new Error('Quantity must be a whole number above 0.')

  const medicine = medicineStmt.get(id)
  if (!medicine) throw new Error('Medicine not found.')
  if (!medicine.is_active) throw new Error('This medicine is inactive and cannot be sold.')

  const batches = sellableStmt.all({ medicineId: id, today: todayLocal() })
  const available = batches.reduce((sum, b) => sum + b.quantity, 0)
  if (wanted > available) {
    return { medicine_id: id, qty: wanted, available, sufficient: false, lines: [] }
  }

  const lines = []
  let remaining = wanted
  for (const b of batches) {
    if (remaining === 0) break
    const take = Math.min(remaining, b.quantity)
    lines.push({
      batch_id: b.id,
      batch_no: b.batch_no,
      expiry_date: b.expiry_date,
      qty: take,
      sale_price: b.sale_price,
    })
    remaining -= take
  }

  return { medicine_id: id, qty: wanted, available, sufficient: true, lines }
}

export function availableQty(medicineId) {
  return availableStmt.get({ medicineId: toId(medicineId, 'medicine'), today: todayLocal() }).available
}

// <prefix>-<YYYYMMDD>-<seq>, e.g. INV-20261029-0007. The sequence comes from the sales already saved
// today rather than a stored counter, which would disagree with the data after a restore from backup.
// Only reserved when called inside createSale's transaction; called on its own it is a preview.
export function nextInvoiceNo() {
  const prefix = getSetting('invoice_prefix')?.trim() || DEFAULT_INVOICE_PREFIX
  const stem = `${prefix}-${todayLocal().replaceAll('-', '')}`
  const { seq } = lastSeqStmt.get({ from: `${stem}-`, to: `${stem}.` })
  return `${stem}-${String((seq ?? 0) + 1).padStart(4, '0')}`
}

// sale: { total, discount, customer_name?, customer_phone?, doctor_name? }
// items: [{ medicine_id, batch_id, qty }], one per batch line; prices are taken from the batch
// payments: [{ method: 'cash' | 'card', amount, reference?, tendered? }]; amount is what is applied to the
// sale, so cash is the amount kept; tendered is what the customer handed over (cash only, for the invoice)
export function createSale(sale, items, payments, userId = null) {
  const header = normalizeSale(sale)
  const lines = normalizeItems(items)
  const paid = normalizePayments(payments)
  // IMMEDIATE takes the write lock at BEGIN, so another connection cannot change stock between
  // the quantity check and the decrement, and the invoice sequence read cannot race either
  return createSaleTx.immediate(header, lines, paid, userId)
}

// Shop details and printer choice, with a fallback for any key missing or blank in settings
export function getInvoiceSettings() {
  const out = { ...INVOICE_SETTING_DEFAULTS }
  for (const { key, value } of invoiceSettingsStmt.all(...Object.keys(INVOICE_SETTING_DEFAULTS))) {
    if (value != null && value.trim() !== '') out[key] = value.trim()
  }
  if (out.invoice_layout !== 'a4') out.invoice_layout = 'thermal'
  return out
}

// Everything an invoice page needs in one object, so the hidden print window makes a single IPC call.
// Read in one transaction so the sale, its lines and payments come from the same snapshot.
const saleForPrintTx = db.transaction((id) => {
  const sale = saleForPrintStmt.get(id)
  if (!sale) throw new Error('Sale not found.')
  const { shop_name, shop_address, shop_phone, licence_no, invoice_footer } = getInvoiceSettings()
  return {
    sale,
    items: itemsForPrintStmt.all(id),
    payments: paymentsForPrintStmt.all(id).map((p) => ({
      ...p,
      change: p.tendered == null ? null : round2(p.tendered - p.amount),
    })),
    shop: { name: shop_name, address: shop_address, phone: shop_phone, licence_no, footer: invoice_footer },
  }
})

export function getSaleForPrint(saleId) {
  return saleForPrintTx(toId(saleId, 'sale'))
}

function normalizeSale(sale = {}) {
  const total = toMoney(sale.total)
  if (total === null) throw new Error('Sale total is missing.')
  const discount = clean(sale.discount) === null ? 0 : toMoney(sale.discount)
  if (discount === null) throw new Error('Discount must be 0 or more.')
  return {
    total,
    discount,
    customer_name: clean(sale.customer_name),
    customer_phone: clean(sale.customer_phone),
    doctor_name: clean(sale.doctor_name),
  }
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('The cart is empty.')
  return items.map((item) => {
    const qty = Number(item?.qty)
    if (!Number.isInteger(qty) || qty <= 0) throw new Error('Quantity must be a whole number above 0.')
    return { medicine_id: toId(item.medicine_id, 'medicine'), batch_id: toId(item.batch_id, 'batch'), qty }
  })
}

function normalizePayments(payments) {
  if (!Array.isArray(payments)) throw new Error('Payment details are missing.')
  return payments.map((p) => {
    if (!PAYMENT_METHODS.includes(p?.method)) throw new Error(`Unknown payment method: ${p?.method}`)
    const amount = toMoney(p.amount)
    if (amount === null || amount === 0) throw new Error('Each payment must be an amount above 0.')
    const reference = clean(p.reference)
    if (p.method === 'card' && reference === null) throw new Error('Card payments need the slip reference.')
    let tendered = null
    if (p.method === 'cash' && clean(p.tendered) !== null) {
      tendered = toMoney(p.tendered)
      if (tendered === null || tendered < amount) throw new Error('Cash tendered cannot be less than the cash due.')
    }
    return { method: p.method, amount, reference, tendered }
  })
}
