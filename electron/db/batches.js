import { db } from './index.js'
import { clean, toId, toMoney } from './validate.js'

// Statements are prepared at load, so this module must be imported after initDb() has run

const REASONS = ['purchase', 'adjustment']
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const listByMedicineStmt = db.prepare(`
  SELECT * FROM batches
  WHERE medicine_id = ?
  ORDER BY expiry_date IS NULL, expiry_date, id
`)

const getStmt = db.prepare('SELECT * FROM batches WHERE id = ?')

const medicineStmt = db.prepare('SELECT id, is_active FROM medicines WHERE id = ?')

const insertStmt = db.prepare(`
  INSERT INTO batches (medicine_id, batch_no, purchase_price, sale_price, quantity, expiry_date, received_at)
  VALUES (@medicine_id, @batch_no, @purchase_price, @sale_price, @quantity, @expiry_date, @received_at)
`)

const applyDeltaStmt = db.prepare('UPDATE batches SET quantity = quantity + @delta WHERE id = @id')

const insertEntryStmt = db.prepare(`
  INSERT INTO stock_entries (batch_id, qty_change, reason, note, user_id, created_at)
  VALUES (@batch_id, @qty_change, @reason, @note, @user_id, @created_at)
`)

// Totals include every batch, expired ones too; sale-time filtering is a later phase's concern
const stockSummaryStmt = db.prepare(`
  SELECT m.id AS medicine_id, m.name, m.reorder_level,
         COALESCE(SUM(b.quantity), 0) AS total_quantity
  FROM medicines m
  LEFT JOIN batches b ON b.medicine_id = m.id
  GROUP BY m.id
  ORDER BY m.name COLLATE NOCASE
`)

// The batch row holds the balance and stock_entries the ledger, so both are written together
const createTx = db.transaction((row, userId) => {
  const medicine = medicineStmt.get(row.medicine_id)
  if (!medicine) throw new Error('Medicine not found.')
  if (!medicine.is_active) throw new Error('Cannot add stock to an inactive medicine.')

  const { lastInsertRowid } = insertStmt.run(row)
  insertEntryStmt.run({
    batch_id: lastInsertRowid,
    qty_change: row.quantity,
    reason: 'purchase',
    note: null,
    user_id: userId,
    created_at: row.received_at,
  })
  return lastInsertRowid
})

const adjustTx = db.transaction((batchId, delta, reason, note, userId) => {
  const batch = getStmt.get(batchId)
  if (!batch) throw new Error('Batch not found.')
  if (batch.quantity + delta < 0) {
    throw new Error(`Cannot remove ${-delta}; the batch only has ${batch.quantity}.`)
  }

  applyDeltaStmt.run({ id: batchId, delta })
  insertEntryStmt.run({
    batch_id: batchId,
    qty_change: delta,
    reason,
    note,
    user_id: userId,
    created_at: new Date().toISOString(),
  })
})

export function listByMedicine(medicineId) {
  return listByMedicineStmt.all(toId(medicineId, 'medicine'))
}

export function create(data, userId = null) {
  const row = normalize(data)
  const id = createTx({ ...row, received_at: new Date().toISOString() }, userId)
  return getStmt.get(id)
}

export function adjustQuantity(batchId, delta, reason, note, userId = null) {
  const id = toId(batchId, 'batch')
  const change = toInteger(delta)
  if (change === null || change === 0) throw new Error('Quantity change must be a non-zero whole number.')
  if (!REASONS.includes(reason)) throw new Error(`Unknown stock reason: ${reason}`)

  adjustTx(id, change, reason, clean(note), userId)
  return getStmt.get(id)
}

export function stockSummary() {
  return stockSummaryStmt.all()
}

function normalize(data = {}) {
  const quantity = toInteger(data.quantity)
  if (quantity === null || quantity <= 0) throw new Error('Quantity must be a whole number above 0.')

  const salePrice = toMoney(data.sale_price)
  if (salePrice === null) throw new Error('Sale price is required and must be 0 or more.')

  const purchaseRaw = clean(data.purchase_price)
  const purchasePrice = purchaseRaw === null ? 0 : toMoney(purchaseRaw)
  if (purchasePrice === null) throw new Error('Purchase price must be 0 or more.')

  // Expiry is a calendar date (YYYY-MM-DD), not an instant, so it carries no time or zone
  const expiry = clean(data.expiry_date)
  if (expiry !== null && (!DATE_ONLY.test(expiry) || Number.isNaN(Date.parse(expiry)))) {
    throw new Error('Expiry date must be a valid date (YYYY-MM-DD).')
  }

  return {
    medicine_id: toId(data.medicine_id, 'medicine'),
    batch_no: clean(data.batch_no),
    purchase_price: purchasePrice,
    sale_price: salePrice,
    quantity,
    expiry_date: expiry,
  }
}

function toInteger(value) {
  const s = clean(value)
  if (s === null) return null
  const n = Number(s)
  return Number.isInteger(n) ? n : null
}
