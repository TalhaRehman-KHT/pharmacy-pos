import { app, BrowserWindow, net, shell } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { CREDENTIALS_FILE, decodeCredentials } from './drive-secret.js'

// Google Drive copies of local backups. Manual only: nothing here runs unless the owner clicks, because
// the app is offline-first and must never depend on, or wait for, the network.
// This layer only moves files. Restoring a downloaded file goes through backup.js restoreBackup.
//
// googleapis and keytar are imported on first use: googleapis is large, and keytar is a native module, so
// a problem with either breaks Drive backup rather than the app's startup.

// drive.file only: the app sees just the files it created, not the rest of the owner's Drive
const SCOPES = ['https://www.googleapis.com/auth/drive.file']
const FOLDER_NAME = 'PharmacyPOS'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
// Windows Credential Manager entry; the account is the connected Google email, the password the refresh token
const KEYTAR_SERVICE = 'Pharmacy POS Google Drive'
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000
// Generous for a slow counter connection; backups are a few MB
const REQUEST_TIMEOUT_MS = 2 * 60 * 1000

export const OFFLINE_MESSAGE =
  'No internet connection, so Google Drive could not be reached. Your local backups are unaffected. Try again when the connection is back.'
const TIMEOUT_MESSAGE =
  'Google Drive did not respond in time. The connection may be down or very slow. Your local backups are unaffected.'
const EXPIRED_MESSAGE = 'Google Drive access has expired or was removed in your Google account. Connect Google Drive again.'

// Errors from Node, undici and gaxios that mean the network, not Google, is the problem
const NETWORK_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
])

// False when this build has no Google client ID (see drive-secret.js); the UI then explains Drive is off
export const isConfigured = () => !!clientCredentials()

// The connected account's email, or null. Read from Credential Manager, so it works offline.
export async function connectedAccount() {
  return (await storedCredential())?.account ?? null
}

// Opens Google's consent screen in the system browser and receives the answer on a one-off listener on
// 127.0.0.1. Google refuses sign-in inside an embedded web view, since the app drawing the page could read
// the password. PKCE and a random state tie the answer to this request. Resolves to the connected email.
// A second call while one is waiting cancels the first, so a closed browser tab never blocks reconnecting.
let cancelPendingSignIn = null
export async function authorise() {
  cancelPendingSignIn?.()
  assertOnline()
  const { google } = await googleapis()

  const verifier = base64url(crypto.randomBytes(32))
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
  const state = base64url(crypto.randomBytes(16))

  const server = http.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const redirectUri = `http://127.0.0.1:${server.address().port}`
  let cancel = null

  try {
    const client = oauthClient(google, redirectUri)
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Google sign-in was not finished within 5 minutes. Click Connect Google Drive to try again.')),
        SIGN_IN_TIMEOUT_MS,
      )
      cancelPendingSignIn = cancel = () => {
        clearTimeout(timer)
        reject(new Error('Sign-in was restarted.'))
      }

      server.on('request', (req, res) => {
        const url = new URL(req.url, redirectUri)
        // The browser also asks for /favicon.ico
        if (url.pathname !== '/') return res.writeHead(404).end()

        const error = url.searchParams.get('error')
        const ok = !error && url.searchParams.get('state') === state && url.searchParams.get('code')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(callbackPage(ok ? 'Google Drive is connected.' : 'Google Drive was not connected.'))
        if (url.searchParams.get('state') !== state) return // not our request; keep waiting

        clearTimeout(timer)
        if (error === 'access_denied') reject(new Error('Google sign-in was cancelled.'))
        else if (error) reject(new Error(`Google sign-in failed: ${error}`))
        else resolve(url.searchParams.get('code'))
      })

      const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        // Asks again each time, so Google always returns a refresh token
        prompt: 'consent',
        scope: SCOPES,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })
      shell.openExternal(authUrl).catch((err) => {
        clearTimeout(timer)
        reject(new Error(`Could not open the web browser: ${err.message}`))
      })
    })

    focusAppWindow()
    const { tokens } = await network(() => client.getToken({ code, codeVerifier: verifier }))
    if (!tokens.refresh_token) throw new Error('Google did not return a long-lived token. Try connecting again.')
    client.setCredentials(tokens)

    const drive = google.drive({ version: 'v3', auth: client, timeout: REQUEST_TIMEOUT_MS })
    const about = await network(() => drive.about.get({ fields: 'user(emailAddress)' }))
    const email = about.data.user?.emailAddress || 'Google account'

    const keytar = await keytarModule()
    await clearCredentials()
    await keytar.setPassword(KEYTAR_SERVICE, email, tokens.refresh_token)
    return email
  } finally {
    // A restarted sign-in has already put its own handle here
    if (cancelPendingSignIn === cancel) cancelPendingSignIn = null
    server.close()
    // The browser keeps its connection open; drop it so the port is released now
    server.closeAllConnections()
  }
}

// Revokes the token at Google and removes it from Credential Manager. The local credential is removed even
// offline; { revoked: false } then means access is still listed in the Google account until removed there.
export async function disconnect() {
  const cred = await storedCredential()
  if (!cred) return { revoked: true }
  let revoked = false
  try {
    assertOnline()
    const { google } = await googleapis()
    // Not through network(): its invalid_grant handling would hide the code checked below
    await oauthClient(google).revokeToken(cred.password)
    revoked = true
  } catch (err) {
    // An already revoked or expired token is as good as revoked
    if (/invalid_token|invalid_grant/.test(responseError(err))) revoked = true
    else console.error('Could not revoke the Google token:', err)
  }
  await clearCredentials()
  return { revoked }
}

// Uploads a local .db.gz backup into the PharmacyPOS folder, creating the folder if needed. A file of the
// same name already there is not uploaded twice. Resolves to { id, name, size, created_at, alreadyUploaded }.
export async function uploadBackup(filePath) {
  const drive = await driveClient()
  const folderId = await ensureFolder(drive)
  const name = path.basename(filePath)

  const existing = await network(() =>
    drive.files.list({
      q: `name = '${escapeQuery(name)}' and '${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, size, createdTime)',
      pageSize: 1,
    }),
  )
  if (existing.data.files.length) return { ...toRemote(existing.data.files[0]), alreadyUploaded: true }

  const created = await network(() =>
    drive.files.create({
      requestBody: { name, parents: [folderId] },
      media: { mimeType: 'application/gzip', body: fs.createReadStream(filePath) },
      fields: 'id, name, size, createdTime',
    }),
  )
  return { ...toRemote(created.data), alreadyUploaded: false }
}

// Newest first: [{ id, name, size, created_at }]. Empty if nothing was ever uploaded.
export async function listRemoteBackups() {
  const drive = await driveClient()
  const folderId = await findFolder(drive)
  if (!folderId) return []

  const out = []
  let pageToken
  do {
    const res = await network(() =>
      drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, size, createdTime)',
        orderBy: 'createdTime desc',
        pageSize: 1000,
        pageToken,
      }),
    )
    out.push(...res.data.files.map(toRemote))
    pageToken = res.data.nextPageToken
  } while (pageToken)
  return out
}

// Downloads one file from the PharmacyPOS folder to destination and resolves to destination. Only moves
// the file; the caller restores it through backup.js, which validates it.
export async function downloadBackup(fileId, destination) {
  if (typeof fileId !== 'string' || !/^[\w-]+$/.test(fileId)) throw new Error('Unknown Drive backup.')
  const drive = await driveClient()
  const folderId = await findFolder(drive)
  const meta = await network(() => drive.files.get({ fileId, fields: 'id, parents, trashed' }))
  if (!folderId || meta.data.trashed || !meta.data.parents?.includes(folderId)) {
    throw new Error(`That file is not a backup in the ${FOLDER_NAME} folder.`)
  }

  // Written beside the destination and renamed, so a dropped connection never leaves a half file in place
  const partial = `${destination}.part`
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  try {
    await network(async () => {
      const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })
      // A Node stream or, from fetch-based gaxios, a web ReadableStream
      const body = typeof res.data.pipe === 'function' ? res.data : Readable.fromWeb(res.data)
      await pipeline(body, fs.createWriteStream(partial))
    })
    await fsp.rename(partial, destination)
  } finally {
    await fsp.rm(partial, { force: true })
  }
  return destination
}

async function driveClient() {
  assertOnline()
  const cred = await storedCredential()
  if (!cred) throw new Error('Google Drive is not connected.')
  const { google } = await googleapis()
  const client = oauthClient(google)
  client.setCredentials({ refresh_token: cred.password })
  // Google may issue a new refresh token on refresh; keep the stored one current
  client.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      keytarModule()
        .then((keytar) => keytar.setPassword(KEYTAR_SERVICE, cred.account, tokens.refresh_token))
        .catch((err) => console.error('Could not store the new Google token:', err))
    }
  })
  return google.drive({ version: 'v3', auth: client, timeout: REQUEST_TIMEOUT_MS })
}

function oauthClient(google, redirectUri) {
  const creds = clientCredentials()
  if (!creds) throw new Error('Google Drive is not set up in this copy of the app.')
  return new google.auth.OAuth2({ clientId: creds.clientId, clientSecret: creds.clientSecret, redirectUri })
}

// Only folders this app created are visible under drive.file
async function findFolder(drive) {
  const res = await network(() =>
    drive.files.list({
      q: `name = '${FOLDER_NAME}' and mimeType = '${FOLDER_MIME}' and 'root' in parents and trashed = false`,
      fields: 'files(id)',
      pageSize: 1,
    }),
  )
  return res.data.files[0]?.id ?? null
}

async function ensureFolder(drive) {
  const existing = await findFolder(drive)
  if (existing) return existing
  const res = await network(() =>
    drive.files.create({ requestBody: { name: FOLDER_NAME, mimeType: FOLDER_MIME, parents: ['root'] }, fields: 'id' }),
  )
  return res.data.id
}

// Runs a Google call and turns the ways it fails into messages the operator can act on. A revoked or
// expired grant also clears the stored credential, so the UI shows Drive as disconnected.
async function network(fn) {
  try {
    return await fn()
  } catch (err) {
    if (isTimeout(err)) throw new Error(TIMEOUT_MESSAGE, { cause: err })
    if (isNetworkError(err)) throw new Error(OFFLINE_MESSAGE, { cause: err })
    if (/invalid_grant/.test(responseError(err))) {
      await clearCredentials().catch(() => {})
      throw new Error(EXPIRED_MESSAGE, { cause: err })
    }
    throw err
  }
}

// Fails fast when Windows reports no connection, before a browser opens or a request waits to time out
function assertOnline() {
  if (!net.isOnline()) throw new Error(OFFLINE_MESSAGE)
}

function isNetworkError(err) {
  for (let e = err, depth = 0; e && depth < 6; e = e.cause, depth++) {
    if (NETWORK_CODES.has(e.code) || NETWORK_CODES.has(e.errno)) return true
    if (e.message === 'fetch failed') return true
  }
  return false
}

function isTimeout(err) {
  for (let e = err, depth = 0; e && depth < 6; e = e.cause, depth++) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return true
  }
  return false
}

// The OAuth error code Google sent, if any (invalid_grant, invalid_token), else the message
function responseError(err) {
  const data = err?.response?.data
  return String(data?.error ?? err?.message ?? '')
}

let credentialsCache
function clientCredentials() {
  if (credentialsCache === undefined) credentialsCache = loadClientCredentials()
  return credentialsCache
}

// Packaged: from the resource written by scripts/write-drive-credentials.js at build time.
// Development: from the environment, with .env in the project root loaded first.
function loadClientCredentials() {
  if (app.isPackaged) {
    try {
      return decodeCredentials(fs.readFileSync(path.join(process.resourcesPath, CREDENTIALS_FILE)))
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('Could not read the Google Drive credentials:', err)
      return null
    }
  }
  try {
    process.loadEnvFile(path.join(app.getAppPath(), '.env'))
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Could not read .env:', err)
  }
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

async function storedCredential() {
  const keytar = await keytarModule()
  return (await keytar.findCredentials(KEYTAR_SERVICE))[0] ?? null
}

async function clearCredentials() {
  const keytar = await keytarModule()
  for (const { account } of await keytar.findCredentials(KEYTAR_SERVICE)) {
    await keytar.deletePassword(KEYTAR_SERVICE, account)
  }
}

// Both are CommonJS; default is module.exports
const googleapis = async () => (await import('googleapis')).default
const keytarModule = async () => (await import('keytar')).default

function toRemote(file) {
  return { id: file.id, name: file.name, size: Number(file.size ?? 0), created_at: file.createdTime }
}

function escapeQuery(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function base64url(buf) {
  return buf.toString('base64url')
}

function focusAppWindow() {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
}

function callbackPage(heading) {
  return `<!doctype html><meta charset="utf-8"><title>Pharmacy POS</title>
<body style="font-family: system-ui, sans-serif; padding: 48px; text-align: center">
<h1 style="font-size: 22px">${heading}</h1><p>You can close this tab and return to Pharmacy POS.</p></body>`
}
