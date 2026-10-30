import { db, setSetting } from './index.js'
import * as recovery from './recovery.js'
import { buildUser, count, insertUser } from './users.js'
import { clean } from './validate.js'

// Imports db/users.js and db/recovery.js, so this module must be imported after initDb() has run

// Setup is needed exactly when no user exists, not when a flag says so: the owner account and the
// shop details are written in one transaction, so there is no state where one exists without the other
export function isNeeded() {
  return count() === 0
}

// shop: { shop_name, shop_address, shop_phone, licence_no, invoice_prefix }
// owner: { username, full_name, password }
// Resolves to { user, recoveryCode }: the new owner (without the password hash) and their first recovery
// code, which is shown once and never stored; only its hash is written, with the owner, in one transaction
export async function complete(shop = {}, owner = {}) {
  if (!isNeeded()) throw new Error('Setup has already been completed.')

  const values = normalizeShop(shop)
  const row = await buildUser({ ...owner, role: 'owner' })
  const { code, hash } = await recovery.newCode()

  // Re-checked inside the transaction: two setup submits could both pass the check above while hashing
  return db.transaction(() => {
    if (!isNeeded()) throw new Error('Setup has already been completed.')
    const user = insertUser(row)
    for (const [key, value] of Object.entries(values)) setSetting(key, value)
    recovery.storeHash(hash)
    return { user, recoveryCode: code }
  }).immediate()
}

function normalizeShop(shop) {
  const values = {
    shop_name: clean(shop.shop_name),
    shop_address: clean(shop.shop_address),
    shop_phone: clean(shop.shop_phone),
    licence_no: clean(shop.licence_no),
    invoice_prefix: clean(shop.invoice_prefix)?.toUpperCase() ?? null,
  }
  if (!values.shop_name) throw new Error('Shop name is required.')
  if (!values.invoice_prefix) throw new Error('Invoice prefix is required.')
  // It becomes the start of every invoice number, e.g. INV-20261029-0001
  if (!/^[A-Z0-9]{1,8}$/.test(values.invoice_prefix)) {
    throw new Error('Invoice prefix must be 1 to 8 letters or digits.')
  }
  return values
}
