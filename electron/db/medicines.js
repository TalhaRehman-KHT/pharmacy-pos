import { db } from './index.js'
import { clean, toId } from './validate.js'

// Statements are prepared at load, so this module must be imported after initDb() has run

const listStmt = db.prepare(`
  SELECT * FROM medicines
  WHERE (@activeOnly = 0 OR is_active = 1)
    AND (@pattern IS NULL
      OR name         LIKE @pattern ESCAPE '\\'
      OR generic_name LIKE @pattern ESCAPE '\\'
      OR company      LIKE @pattern ESCAPE '\\'
      OR barcode      LIKE @pattern ESCAPE '\\')
  ORDER BY name COLLATE NOCASE
`)

const getStmt = db.prepare('SELECT * FROM medicines WHERE id = ?')

const insertStmt = db.prepare(`
  INSERT INTO medicines (name, generic_name, company, category, unit, barcode, reorder_level, is_active, created_at)
  VALUES (@name, @generic_name, @company, @category, @unit, @barcode, @reorder_level, 1, @created_at)
`)

const updateStmt = db.prepare(`
  UPDATE medicines SET
    name = @name,
    generic_name = @generic_name,
    company = @company,
    category = @category,
    unit = @unit,
    barcode = @barcode,
    reorder_level = @reorder_level
  WHERE id = @id
`)

const deactivateStmt = db.prepare('UPDATE medicines SET is_active = 0 WHERE id = ?')

export function list({ search = '', activeOnly = true } = {}) {
  const term = String(search ?? '').trim()
  return listStmt.all({
    activeOnly: activeOnly ? 1 : 0,
    // Escape LIKE wildcards so a search for "50%" matches literally
    pattern: term ? `%${term.replace(/[\\%_]/g, '\\$&')}%` : null,
  })
}

export function get(id) {
  return getStmt.get(toId(id, 'medicine')) ?? null
}

export function create(data) {
  const row = normalize(data)
  const info = withFriendlyErrors(() =>
    insertStmt.run({ ...row, created_at: new Date().toISOString() }),
  )
  return get(info.lastInsertRowid)
}

export function update(id, data) {
  const medicineId = toId(id, 'medicine')
  const info = withFriendlyErrors(() => updateStmt.run({ ...normalize(data), id: medicineId }))
  if (info.changes === 0) throw new Error('Medicine not found.')
  return get(medicineId)
}

export function deactivate(id) {
  const medicineId = toId(id, 'medicine')
  if (deactivateStmt.run(medicineId).changes === 0) throw new Error('Medicine not found.')
  return get(medicineId)
}

function normalize(data = {}) {
  const name = clean(data.name)
  if (!name) throw new Error('Name is required.')

  let reorder = data.reorder_level ?? 10
  if (typeof reorder === 'string') reorder = reorder.trim() === '' ? NaN : Number(reorder)
  if (!Number.isInteger(reorder) || reorder < 0) {
    throw new Error('Reorder level must be a non-negative whole number.')
  }

  return {
    name,
    generic_name: clean(data.generic_name),
    company: clean(data.company),
    category: clean(data.category),
    unit: clean(data.unit) ?? 'tablet',
    // Empty barcodes must be NULL, not '', or the UNIQUE constraint allows only one
    barcode: clean(data.barcode),
    reorder_level: reorder,
  }
}

function withFriendlyErrors(fn) {
  try {
    return fn()
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' && err.message.includes('medicines.barcode')) {
      throw new Error('Another medicine already uses this barcode.')
    }
    throw err
  }
}
