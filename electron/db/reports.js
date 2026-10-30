import { db } from './index.js'
import { getSaleForPrint } from './sales.js'
import { round2, todayLocal } from './validate.js'

// Statements are prepared at load, so this module must be imported after initDb() has run

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const MAX_EXPIRY_DAYS = 3650
const DEFAULT_TOP_LIMIT = 10
const MAX_TOP_LIMIT = 100
// Bounds the daily chart; ten years still covers any report the shop would ask for
const MAX_RANGE_DAYS = 3660

// Sellable stock per active medicine. Expired batches are left out: stock that cannot be sold is not
// stock. Computed on every read rather than stored, so it cannot drift from the batch quantities.
const STOCK_LEVELS = `
  SELECT m.id AS medicine_id, m.name, m.generic_name, m.company, m.unit, m.reorder_level,
         COALESCE(SUM(b.quantity), 0) AS quantity
  FROM medicines m
  LEFT JOIN batches b
    ON b.medicine_id = m.id
   AND b.quantity > 0
   AND (b.expiry_date IS NULL OR b.expiry_date >= @today)
  WHERE m.is_active = 1
  GROUP BY m.id
`

// A reorder level of 0 means the shop has chosen not to restock the item, so it never raises an alert.
// Shared by the list and the dashboard count so the two cannot disagree.
const IS_LOW_STOCK = 'reorder_level > 0 AND quantity <= reorder_level'

const lowStockStmt = db.prepare(`
  SELECT *, reorder_level - quantity AS shortfall
  FROM (${STOCK_LEVELS})
  WHERE ${IS_LOW_STOCK}
  ORDER BY shortfall DESC, name COLLATE NOCASE
`)

const lowStockCountStmt = db.prepare(`
  SELECT COUNT(*) AS count
  FROM (${STOCK_LEVELS})
  WHERE ${IS_LOW_STOCK}
`)

// Valued at purchase price: expired stock is a loss of what was paid for it, not of what it might have fetched.
// Inactive medicines are kept in: their stock is still on the shelf and still has to be dealt with.
const BATCH_EXPIRY_COLUMNS = `
  b.id, b.batch_no, b.quantity, b.purchase_price, b.expiry_date,
  ROUND(b.quantity * b.purchase_price, 2) AS value,
  m.id AS medicine_id, m.name, m.is_active
`

const expiringStmt = db.prepare(`
  SELECT ${BATCH_EXPIRY_COLUMNS}
  FROM batches b
  JOIN medicines m ON m.id = b.medicine_id
  WHERE b.quantity > 0 AND b.expiry_date >= @today AND b.expiry_date <= @until
  ORDER BY b.expiry_date, m.name COLLATE NOCASE, b.id
`)

const expiredStmt = db.prepare(`
  SELECT ${BATCH_EXPIRY_COLUMNS}
  FROM batches b
  JOIN medicines m ON m.id = b.medicine_id
  WHERE b.quantity > 0 AND b.expiry_date < @today
  ORDER BY b.expiry_date, m.name COLLATE NOCASE, b.id
`)

const expiringCountStmt = db.prepare(`
  SELECT COUNT(*) AS count
  FROM batches
  WHERE quantity > 0 AND expiry_date >= @today AND expiry_date <= @until
`)

// Subqueries rather than joins, so items and payments do not multiply each other's rows.
// Items are counted per medicine: one medicine split across two batches is still one item.
const salesHistoryStmt = db.prepare(`
  SELECT s.id, s.invoice_no, s.created_at, s.total, s.status,
         (SELECT COUNT(DISTINCT i.medicine_id) FROM sale_items i WHERE i.sale_id = s.id) AS item_count,
         -- DISTINCT limits GROUP_CONCAT to its default ',' separator, hence the REPLACE
         (SELECT REPLACE(GROUP_CONCAT(DISTINCT p.method), ',', ', ')
            FROM payments p WHERE p.sale_id = s.id) AS payment_methods
  FROM sales s
  WHERE s.created_at >= @from AND s.created_at < @to
  ORDER BY s.created_at DESC, s.id DESC
`)

// Only completed sales count towards takings
const todayTotalStmt = db.prepare(`
  SELECT COALESCE(SUM(total), 0) AS total
  FROM sales
  WHERE status = 'completed' AND created_at >= @from AND created_at < @to
`)

const todayBillCountStmt = db.prepare(`
  SELECT COUNT(*) AS count
  FROM sales
  WHERE status = 'completed' AND created_at >= @from AND created_at < @to
`)

// Phase 9 reports. Every figure counts completed sales only, matching the dashboard and sales history.
// @from and @to are a UTC range [from, to) built from local calendar dates by toUtcRange().
const COMPLETED_IN_RANGE = "s.status = 'completed' AND s.created_at >= @from AND s.created_at < @to"

const summaryStmt = db.prepare(`
  SELECT COUNT(*) AS bill_count, COALESCE(SUM(s.total), 0) AS total_sales
  FROM sales s
  WHERE ${COMPLETED_IN_RANGE}
`)

// From payments, not the sale: a split-tender sale puts its cash part under cash and its card part under card
const paymentSplitStmt = db.prepare(`
  SELECT p.method, COALESCE(SUM(p.amount), 0) AS amount
  FROM payments p
  JOIN sales s ON s.id = p.sale_id
  WHERE ${COMPLETED_IN_RANGE}
  GROUP BY p.method
`)

// Value is the line total, before any bill-level discount. One medicine sold from two batches is one row.
const TOP_SELLING = `
  SELECT i.medicine_id, m.name, m.unit,
         SUM(i.qty) AS quantity, ROUND(SUM(i.line_total), 2) AS value
  FROM sale_items i
  JOIN sales s ON s.id = i.sale_id
  JOIN medicines m ON m.id = i.medicine_id
  WHERE ${COMPLETED_IN_RANGE}
  GROUP BY i.medicine_id
`

const topByQuantityStmt = db.prepare(`
  ${TOP_SELLING}
  ORDER BY quantity DESC, value DESC, m.name COLLATE NOCASE
  LIMIT @limit
`)

const topByValueStmt = db.prepare(`
  ${TOP_SELLING}
  ORDER BY value DESC, quantity DESC, m.name COLLATE NOCASE
  LIMIT @limit
`)

// Purchase price belongs to the batch (the consignment), so cost is only knowable through sale_items.batch_id.
// A line's sale value is its share of the bill after discount: line_total * (subtotal - discount) / subtotal.
// Tax is left out: it is collected for the government, not earned.
// A line with no batch (null, or the batch row is gone) has no known cost, so it is reported apart
// rather than counted as pure profit.
const marginStmt = db.prepare(`
  SELECT
    COUNT(*) AS line_count,
    COALESCE(SUM(l.net), 0) AS sales_value,
    COALESCE(SUM(CASE WHEN b.id IS NOT NULL THEN l.net END), 0) AS attributed_sales,
    COALESCE(SUM(CASE WHEN b.id IS NOT NULL THEN l.qty * b.purchase_price END), 0) AS attributed_cost,
    COALESCE(SUM(CASE WHEN b.id IS NULL THEN 1 ELSE 0 END), 0) AS unattributed_lines,
    COALESCE(SUM(CASE WHEN b.id IS NULL THEN l.net END), 0) AS unattributed_sales,
    -- Stock received without a purchase price is stored at 0 and would read as a 100% margin
    COALESCE(SUM(CASE WHEN b.id IS NOT NULL AND b.purchase_price = 0 THEN 1 ELSE 0 END), 0) AS zero_cost_lines,
    COALESCE(SUM(CASE WHEN b.id IS NOT NULL AND b.purchase_price = 0 THEN l.net END), 0) AS zero_cost_sales
  FROM (
    SELECT i.batch_id, i.qty,
           CASE WHEN s.subtotal > 0 THEN i.line_total * (s.subtotal - s.discount) / s.subtotal ELSE 0 END AS net
    FROM sale_items i
    JOIN sales s ON s.id = i.sale_id
    WHERE ${COMPLETED_IN_RANGE}
  ) l
  LEFT JOIN batches b ON b.id = l.batch_id
`)

// 'localtime' groups by the pharmacy's calendar day, in the same OS time zone todayLocal() uses
const dailyTotalsStmt = db.prepare(`
  SELECT date(s.created_at, 'localtime') AS date, COALESCE(SUM(s.total), 0) AS total, COUNT(*) AS bill_count
  FROM sales s
  WHERE ${COMPLETED_IN_RANGE}
  GROUP BY date(s.created_at, 'localtime')
`)

export function lowStock() {
  return lowStockStmt.all({ today: todayLocal() })
}

export function lowStockCount() {
  return lowStockCountStmt.get({ today: todayLocal() }).count
}

// Batches expiring from today through today + days, and separately those already past expiry
export function expiring(days) {
  const window = toDays(days)
  const today = todayLocal()
  return {
    expiring: expiringStmt.all({ today, until: addDays(today, window) }),
    expired: expiredStmt.all({ today }),
  }
}

export function expiringCount(days) {
  const today = todayLocal()
  return expiringCountStmt.get({ today, until: addDays(today, toDays(days)) }).count
}

// from and to are local calendar dates (YYYY-MM-DD), both inclusive
export function salesHistory(range) {
  return salesHistoryStmt.all(toUtcRange(range))
}

// The four functions below also take { from, to } as local calendar dates, both inclusive

// { total_sales, bill_count, average_bill, cash, card, other }. cash + card + other equals total_sales,
// because each payment row records the amount applied to its sale.
export function salesSummary(range) {
  const params = toUtcRange(range)
  // One snapshot, so a sale saved between the two reads cannot make the split disagree with the total
  const { summary, split } = db.transaction(() => ({
    summary: summaryStmt.get(params),
    split: paymentSplitStmt.all(params),
  }))()

  const byMethod = { cash: 0, card: 0, other: 0 }
  for (const { method, amount } of split) {
    const key = method === 'cash' || method === 'card' ? method : 'other'
    byMethod[key] = round2(byMethod[key] + amount)
  }
  return {
    total_sales: round2(summary.total_sales),
    bill_count: summary.bill_count,
    average_bill: summary.bill_count ? round2(summary.total_sales / summary.bill_count) : 0,
    ...byMethod,
  }
}

// { byQuantity, byValue }, each a list of { medicine_id, name, unit, quantity, value }
export function topSelling({ from, to, limit } = {}) {
  const params = { ...toUtcRange({ from, to }), limit: toLimit(limit) }
  return db.transaction(() => ({
    byQuantity: topByQuantityStmt.all(params),
    byValue: topByValueStmt.all(params),
  }))()
}

// margin and margin_pct cover attributed lines only; unattributed_* is the part that could not be costed
export function grossMargin(range) {
  const r = marginStmt.get(toUtcRange(range))
  const sales = round2(r.attributed_sales)
  const cost = round2(r.attributed_cost)
  const margin = round2(sales - cost)
  return {
    sales_value: round2(r.sales_value),
    attributed_sales: sales,
    cost,
    margin,
    margin_pct: sales > 0 ? Math.round((margin / sales) * 1000) / 10 : null,
    line_count: r.line_count,
    unattributed_lines: r.unattributed_lines,
    unattributed_sales: round2(r.unattributed_sales),
    zero_cost_lines: r.zero_cost_lines,
    zero_cost_sales: round2(r.zero_cost_sales),
  }
}

// One row per day in the range, days without sales included, so the chart has a bar for every day
export function dailyTotals(range) {
  const { from, to } = checkRange(range)
  const found = new Map(dailyTotalsStmt.all(toUtcRange(range)).map((r) => [r.date, r]))
  const days = []
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const row = found.get(day)
    days.push({ date: day, total: row ? round2(row.total) : 0, bill_count: row ? row.bill_count : 0 })
  }
  return days
}

// The same data the printed invoice is built from, so the detail view shows exactly what was printed
export function saleDetail(saleId) {
  const { sale, items, payments } = getSaleForPrint(saleId)
  return { sale, items, payments }
}

export function todaySalesTotal() {
  return todayTotalStmt.get(todayRange()).total
}

export function todayBillCount() {
  return todayBillCountStmt.get(todayRange()).count
}

// Sales are stored as UTC instants, so the pharmacy's local day becomes a UTC range [from, to)
function todayRange() {
  const today = todayLocal()
  return { from: localMidnightUtc(today), to: localMidnightUtc(addDays(today, 1)) }
}

function checkRange({ from, to } = {}) {
  if (!isDate(from) || !isDate(to)) throw new Error('Dates must be valid (YYYY-MM-DD).')
  if (from > to) throw new Error('The start date is after the end date.')
  if (addDays(from, MAX_RANGE_DAYS) < to) throw new Error(`The range cannot be longer than ${MAX_RANGE_DAYS} days.`)
  return { from, to }
}

// Inclusive local dates to the UTC range [from, to) that created_at is compared against
function toUtcRange(range) {
  const { from, to } = checkRange(range)
  return { from: localMidnightUtc(from), to: localMidnightUtc(addDays(to, 1)) }
}

function localMidnightUtc(dateOnly) {
  const [y, m, d] = dateOnly.split('-').map(Number)
  return new Date(y, m - 1, d).toISOString()
}

// Calendar arithmetic in UTC so a DST change cannot shift the result by a day
function addDays(dateOnly, days) {
  const [y, m, d] = dateOnly.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function isDate(value) {
  return typeof value === 'string' && DATE_ONLY.test(value) && !Number.isNaN(Date.parse(value))
}

function toLimit(limit) {
  if (limit == null) return DEFAULT_TOP_LIMIT
  const n = Number(limit)
  if (!Number.isInteger(n) || n < 1 || n > MAX_TOP_LIMIT) {
    throw new Error(`Limit must be a whole number from 1 to ${MAX_TOP_LIMIT}.`)
  }
  return n
}

function toDays(days) {
  const n = Number(days)
  if (!Number.isInteger(n) || n < 0 || n > MAX_EXPIRY_DAYS) {
    throw new Error(`Days must be a whole number from 0 to ${MAX_EXPIRY_DAYS}.`)
  }
  return n
}
