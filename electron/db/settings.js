import { db, getSetting, setSetting } from './index.js'
import { clean } from './validate.js'

// The keys the Settings screen edits. Everything that uses them (invoice numbers, printing, the invoice
// pages) reads the settings table on each use, so a save takes effect without a restart.
const KEYS = [
  'shop_name',
  'shop_address',
  'shop_phone',
  'licence_no',
  'invoice_prefix',
  'tax_percent',
  'invoice_footer',
  'printer_name',
  'invoice_layout',
]

const LAYOUTS = ['thermal', 'a4']

// Missing keys come back as '' (or the default layout), so the form always has a value to show
export function getAll() {
  const out = Object.fromEntries(KEYS.map((key) => [key, getSetting(key) ?? '']))
  if (!LAYOUTS.includes(out.invoice_layout)) out.invoice_layout = 'thermal'
  if (out.tax_percent === '') out.tax_percent = '0'
  return out
}

// Saves every key in one transaction and resolves to the stored values
export function save(data = {}) {
  const values = normalize(data)
  db.transaction(() => {
    for (const [key, value] of Object.entries(values)) setSetting(key, value)
  })()
  return getAll()
}

function normalize(data) {
  const values = {
    shop_name: clean(data.shop_name),
    shop_address: clean(data.shop_address),
    shop_phone: clean(data.shop_phone),
    licence_no: clean(data.licence_no),
    invoice_prefix: clean(data.invoice_prefix)?.toUpperCase() ?? null,
    tax_percent: clean(data.tax_percent) ?? '0',
    invoice_footer: clean(data.invoice_footer),
    // Empty means no printer: invoices are saved as PDF instead (see electron/print.js)
    printer_name: clean(data.printer_name) ?? '',
    invoice_layout: clean(data.invoice_layout),
  }

  if (!values.shop_name) throw new Error('Shop name is required.')
  if (!values.invoice_prefix) throw new Error('Invoice prefix is required.')
  // Same rule as first-run setup: it becomes the start of every invoice number, e.g. INV-20261029-0001
  if (!/^[A-Z0-9]{1,8}$/.test(values.invoice_prefix)) {
    throw new Error('Invoice prefix must be 1 to 8 letters or digits.')
  }

  const tax = Number(values.tax_percent)
  if (!Number.isFinite(tax) || tax < 0 || tax > 100) throw new Error('Tax must be a percentage from 0 to 100.')
  values.tax_percent = String(Math.round(tax * 100) / 100)

  if (!LAYOUTS.includes(values.invoice_layout)) throw new Error('Invoice layout must be thermal or A4.')

  return values
}
