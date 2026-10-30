import { BrowserWindow, ipcMain, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { invoicesDir } from './data-folders.js'
import { getInvoiceSettings } from './db/sales.js'

// Imports db/sales.js, so this module must be imported after initDb() has run

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const INVOICE_DIR = path.join(__dirname, '..', 'invoice')
const RENDER_TIMEOUT_MS = 15_000

// Window widths match the paper so the page lays out as it will print (CSS px are 1/96 in)
const LAYOUTS = {
  thermal: { file: 'thermal.html', width: 302 },
  a4: { file: 'a4.html', width: 794 },
}

const MICRONS_PER_PX = 25_400 / 96
const THERMAL_WIDTH_MICRONS = 80_000

// webContents id -> { resolve, reject } for invoice pages that have not reported back yet
const pendingRenders = new Map()

ipcMain.on('invoice:rendered', (event, info) => {
  const pending = pendingRenders.get(event.sender.id)
  if (!pending) return
  pendingRenders.delete(event.sender.id)
  if (info?.error) pending.reject(new Error(info.error))
  else pending.resolve(info)
})

// Sends the sale to the configured printer. With no printer configured it saves a PDF and opens it,
// so invoices can be checked without a thermal printer attached.
// Resolves to { printed: true, printer } or { printed: false, pdfPath }.
export async function printInvoice(saleId, { reprint = false } = {}) {
  const settings = getInvoiceSettings()
  const layout = settings.invoice_layout

  if (!settings.printer_name) {
    const pdfPath = await exportPdf(saleId, null, { reprint, layout })
    const openError = await shell.openPath(pdfPath)
    if (openError) throw new Error(`Saved ${pdfPath} but could not open it: ${openError}`)
    return { printed: false, pdfPath }
  }

  return withInvoiceWindow(saleId, layout, reprint, async (win, info) => {
    const printers = await win.webContents.getPrintersAsync()
    if (!printers.some((p) => p.name === settings.printer_name)) {
      throw new Error(`Printer "${settings.printer_name}" was not found. Check that it is connected and switched on.`)
    }

    const options = {
      silent: true,
      deviceName: settings.printer_name,
      printBackground: false,
    }
    if (layout === 'thermal') {
      // Roll paper: one page exactly as long as the receipt
      options.margins = { marginType: 'none' }
      options.pageSize = { width: THERMAL_WIDTH_MICRONS, height: Math.ceil(info.heightPx * MICRONS_PER_PX) }
    } else {
      options.pageSize = 'A4'
    }

    await new Promise((resolve, reject) => {
      win.webContents.print(options, (success, failureReason) => {
        if (success) resolve()
        else reject(new Error(`Printing failed: ${failureReason || 'unknown reason'}`))
      })
    })
    return { printed: true, printer: settings.printer_name }
  })
}

// filePath null saves to the invoices data folder as <invoice_no>.pdf. Resolves to the path written.
export async function exportPdf(saleId, filePath, { reprint = false, layout } = {}) {
  const chosenLayout = layout ?? getInvoiceSettings().invoice_layout

  return withInvoiceWindow(saleId, chosenLayout, reprint, async (win, info) => {
    const options = { printBackground: false }
    if (chosenLayout === 'thermal') {
      // printToPDF takes inches
      options.margins = { top: 0, bottom: 0, left: 0, right: 0 }
      options.pageSize = { width: 80 / 25.4, height: info.heightPx / 96 }
    } else {
      options.pageSize = 'A4'
      options.preferCSSPageSize = true
    }

    const pdf = await win.webContents.printToPDF(options)
    const target = filePath ?? path.join(invoicesDir(), `${safeFileName(info.invoiceNo)}.pdf`)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, pdf)
    return target
  })
}

export async function listPrinters() {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win) return []
  const printers = await win.webContents.getPrintersAsync()
  return printers.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault }))
}

// Loads the invoice page in a hidden window, waits for it to draw the sale, runs fn, and always
// closes the window afterwards, whether fn succeeds or fails
async function withInvoiceWindow(saleId, layout, reprint, fn) {
  const { file, width } = LAYOUTS[layout] ?? LAYOUTS.thermal
  const win = new BrowserWindow({
    show: false,
    width,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'invoice-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  const id = win.webContents.id
  let timer

  try {
    const rendered = new Promise((resolve, reject) => {
      pendingRenders.set(id, { resolve, reject })
      timer = setTimeout(() => {
        if (pendingRenders.delete(id)) reject(new Error('The invoice took too long to prepare.'))
      }, RENDER_TIMEOUT_MS)
    })
    // The page can report back before loadFile resolves; mark the promise handled until it is awaited
    rendered.catch(() => {})
    const query = { id: String(saleId) }
    if (reprint) query.copy = 'duplicate'
    await win.loadFile(path.join(INVOICE_DIR, file), { query })
    const info = await rendered
    return await fn(win, info)
  } finally {
    clearTimeout(timer)
    pendingRenders.delete(id)
    if (!win.isDestroyed()) win.destroy()
  }
}

function safeFileName(name) {
  return String(name || 'invoice').replace(/[^\w.-]+/g, '_')
}
