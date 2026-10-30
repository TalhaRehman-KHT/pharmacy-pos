import { BrowserWindow, dialog } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { reportsDir } from './data-folders.js'
import { dailyTotals, grossMargin, salesSummary, topSelling } from './db/reports.js'

// Imports db/reports.js, so this module must be imported after initDb() has run

// Rebuilds the report from the database for the given range rather than taking rows from the renderer,
// so the channel can only ever write a report, never arbitrary content, to the chosen file.
// Resolves to { saved: true, filePath } or { saved: false } if the save dialog was cancelled.
export async function exportReportCsv({ from, to, limit } = {}) {
  const summary = salesSummary({ from, to })
  const margin = grossMargin({ from, to })
  const top = topSelling({ from, to, limit })
  const days = dailyTotals({ from, to })

  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const { canceled, filePath } = await dialog.showSaveDialog(parent, {
    title: 'Export report',
    // Starts in the reports data folder; the owner can still save anywhere
    defaultPath: path.join(reportsDir(), `sales-report-${from}-to-${to}.csv`),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  if (canceled || !filePath) return { saved: false }

  const rows = [
    ['Sales report', `${from} to ${to}`],
    ['Completed sales only; amounts in PKR'],
    [],
    ['Summary'],
    ['Total sales', summary.total_sales],
    ['Bills', summary.bill_count],
    ['Average bill', summary.average_bill],
    ['Cash', summary.cash],
    ['Card', summary.card],
    ...(summary.other ? [['Other payments', summary.other]] : []),
    [],
    ['Gross margin'],
    ['Sales (after discount, costed lines)', margin.attributed_sales],
    ['Purchase cost', margin.cost],
    ['Margin', margin.margin],
    ['Margin %', margin.margin_pct ?? ''],
    ['Lines without a batch (not costed)', margin.unattributed_lines],
    ['Sales without a batch', margin.unattributed_sales],
    ['Lines from batches with no purchase price', margin.zero_cost_lines],
    [],
    ['Daily totals'],
    ['Date', 'Bills', 'Total'],
    ...days.map((d) => [d.date, d.bill_count, d.total]),
    [],
    ['Top selling by quantity'],
    ['Medicine', 'Unit', 'Quantity', 'Value'],
    ...top.byQuantity.map((r) => [r.name, r.unit, r.quantity, r.value]),
    [],
    ['Top selling by value'],
    ['Medicine', 'Unit', 'Quantity', 'Value'],
    ...top.byValue.map((r) => [r.name, r.unit, r.quantity, r.value]),
  ]

  // The BOM makes Excel read the file as UTF-8; CRLF is what Excel on Windows expects
  const csv = '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
  await fs.writeFile(filePath, csv, 'utf8')
  return { saved: true, filePath }
}

function csvCell(value) {
  if (value == null) return ''
  if (typeof value === 'number') return String(value)
  let s = String(value)
  // A medicine name starting with = + - @ would otherwise run as a formula when opened in Excel
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}
