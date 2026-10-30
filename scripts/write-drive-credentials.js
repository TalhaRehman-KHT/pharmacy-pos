// Build step for the packaged app: packs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET into
// build/drive-credentials.bin, which electron-builder ships as an extra resource. Plain Node, no native
// modules, so it runs with node rather than Electron:
//   node scripts/write-drive-credentials.js
// Reads the variables from the environment (CI), or from .env when they are not set.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CREDENTIALS_FILE, encodeCredentials } from '../electron/drive-secret.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  try {
    process.loadEnvFile(path.join(root, '.env'))
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}

const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
if (!clientId || !clientSecret) {
  console.error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set, in the environment or in .env.')
  console.error('Without them the packaged app has no Google Drive backup.')
  process.exit(1)
}

const out = path.join(root, 'build', CREDENTIALS_FILE)
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, encodeCredentials({ clientId, clientSecret }))
console.log(`Wrote ${path.relative(root, out)}`)
