import crypto from 'node:crypto'

// Packs the Google OAuth client ID and secret for the packaged app, so they are not shipped as plain text.
// This is obfuscation, not secrecy: the key is in this file, which ships too. Google treats a Desktop
// client's secret as non-confidential for that reason; what protects the sign-in is the loopback redirect
// with PKCE in drive.js and the refresh token kept in Credential Manager.
// Plain Node only (no Electron imports), so scripts/write-drive-credentials.js can use it at build time.

export const CREDENTIALS_FILE = 'drive-credentials.bin'

const KEY = crypto.createHash('sha256').update('pharmacy-pos/drive-credentials/v1').digest()
const IV_BYTES = 12
const TAG_BYTES = 16

export function encodeCredentials({ clientId, clientSecret }) {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv)
  const body = Buffer.concat([cipher.update(JSON.stringify({ clientId, clientSecret }), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body])
}

// Throws if the file is damaged or was not written by encodeCredentials
export function decodeCredentials(buf) {
  const iv = buf.subarray(0, IV_BYTES)
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv)
  decipher.setAuthTag(tag)
  const json = Buffer.concat([decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8')
  const { clientId, clientSecret } = JSON.parse(json)
  return { clientId, clientSecret }
}
