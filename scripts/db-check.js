// Standalone sanity check for the app database. better-sqlite3 is built for Electron,
// so run it with Electron's bundled Node rather than plain node:
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/db-check.js
import Database from 'better-sqlite3'
import path from 'node:path'

if (!process.env.APPDATA) {
  console.error('APPDATA is not set; this script expects Windows.')
  process.exit(1)
}

// Mirrors app.getPath('userData'), which Electron derives from the package.json name
const dbPath = path.join(process.env.APPDATA, 'pharmacy-pos', 'pharmacy.db')

let db
try {
  // fileMustExist stops better-sqlite3 from silently creating an empty database
  db = new Database(dbPath, { fileMustExist: true })
} catch (err) {
  console.error(`Could not open ${dbPath}: ${err.message}`)
  console.error('Start the app once so it creates the database, then rerun this script.')
  process.exit(1)
}
db.pragma('foreign_keys = ON')

console.log(`Database: ${dbPath}\n`)

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()

console.log('Tables:')
for (const { name } of tables) {
  const { count } = db.prepare(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`).get()
  console.log(`  ${name.padEnd(16)} ${count}`)
}

// Rolled back rather than deleted: a DELETE would still leave the AUTOINCREMENT
// counter in sqlite_sequence advanced, so the database would not be as we found it
db.exec('BEGIN')
try {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO medicines (name, generic_name, company, category, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('DB check test medicine', 'Paracetamol', 'Test Co', 'Analgesic', new Date().toISOString())

  console.log('\nInserted test medicine (rolled back afterwards):')
  console.log(db.prepare('SELECT * FROM medicines WHERE id = ?').get(lastInsertRowid))
} finally {
  db.exec('ROLLBACK')
}

db.close()
