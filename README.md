# Pharmacy POS

Offline point-of-sale, stock and backup system for a single retail pharmacy, as a Windows desktop app.

Pharmacy POS is an Electron app for one independent pharmacy running on one Windows computer. It handles
the medicine catalogue, stock by batch and expiry date, billing with receipt printing, sales reports, staff
accounts, and backups. Everything is stored in a local SQLite database, so the shop keeps working with no
internet connection and no server. Each shop installs its own copy, and no data is shared between shops.
Google Drive backup is the only feature that uses the network, and it runs only when the owner clicks it.

Shop owners install and use it with [INSTALL.md](INSTALL.md), which is written for them rather than for
developers.

## Screenshots

<!-- Replace each placeholder with a screenshot, e.g. docs/screenshots/dashboard.png -->

| Dashboard | Billing |
| --- | --- |
| _Screenshot to come_ | _Screenshot to come_ |

| Reports | Settings |
| --- | --- |
| _Screenshot to come_ | _Screenshot to come_ |

## Features

### Inventory

- Medicine catalogue with generic name, company, category, unit, barcode and reorder level. Search by any
  of them, or scan a barcode.
- Stock is received in batches, each with its own batch number, expiry date, purchase price and sale
  price.
- Every change in quantity is written to a stock ledger. Only the owner can adjust stock by hand, and an
  adjustment needs a reason and a note.
- Low stock and expiry pages list what needs reordering and what expires within 90 days or has already
  expired. Expired stock is valued at cost.

### Billing

- Built for the keyboard: F1 search, F2 payment, F9 save, Esc clear the cart. Barcode scanners work
  in the search box.
- Batches are sold first-expiry-first-out. Expired stock cannot be sold.
- Discounts by amount or percentage. Payment by cash, card, or split between the two, with change worked
  out from the cash tendered.
- Invoice numbers like `INV-20261029-0001`, with a prefix set by the owner.
- Prints an 80 mm thermal receipt or an A4 invoice. With no printer set up, the invoice is saved as a PDF
  instead. Reprints are marked as copies.

### Reporting

- Dashboard with today's sales, bills today, low stock items and batches expiring soon.
- Sales history by date range, with the full detail of any bill and a reprint button.
- Owner-only reports for any date range: total sales, bill count, average bill, cash and card totals,
  gross margin, a daily sales chart, and top sellers by quantity and by value.
- CSV export of the reports.

### Backup

- Automatic backup every 6 hours and every time the app closes, plus a manual "Back up now".
- Retention keeps the 10 newest backups, the last backup of each day for 30 days, and the 3 newest copies
  taken before a restore.
- Restore from the list, from a file (for example a USB stick), or from Google Drive. Every restore saves a
  copy of the current data first, checks the backup file, then restarts the app.
- If the database fails its integrity check at startup, the app offers to restore before it opens.
- Optional Google Drive backup into a `PharmacyPOS` folder in the owner's own Drive. The app can see only
  the files it created there.

### Security

- Two roles, owner and salesman. Every request from the screen to the database is checked against the
  role in the main process (`authorize()` in `electron/main.js`), not only hidden in the UI.
- Salesmen cannot see reports, users or settings.
- There is no sign-up on the login screen. The owner account is created by first-run setup, and staff
  accounts are created by the owner.
- Passwords are hashed with bcrypt.
- Owner password recovery uses a one-time recovery code shown at setup. Only its hash is stored. After 5
  wrong codes, recovery locks for 15 minutes, and the lock survives a restart. Making a new code from
  Settings asks for the current password first. There are no security questions and no vendor backdoor.
- The Google Drive refresh token is kept in Windows Credential Manager, not in the database.

## Tech stack

| Part | Choice |
| --- | --- |
| Desktop shell | Electron 45, ES modules |
| UI | React 19 and Vite 8, plain JavaScript, no UI or CSS library |
| Database | SQLite through `better-sqlite3`, used only in the main process |
| Passwords | `bcryptjs` |
| Drive backup | `googleapis` (OAuth with loopback redirect and PKCE, scope `drive.file`), `keytar` for the token |
| Installer | `electron-builder`, NSIS, Windows x64 |
| Lint | `oxlint` |

The renderer never touches the database. All data access runs in the main process and reaches the
screen through `electron/preload.js`.

```
electron/        main process: window, IPC and role checks, backup, Drive, printing, CSV export
  db/            schema.sql, migrations/, one module per area (medicines, batches, sales, ...)
src/             React renderer
  components/    shared UI (Button, Modal, Table, Toast, ...)
  pages/         one file per screen
  lib/api.js     the renderer's only data access
  tokens.css     colours, spacing and type sizes
invoice/         thermal and A4 invoice templates
scripts/         db-check.js, write-drive-credentials.js
build/           icon.ico, installer.nsh, drive-credentials.bin (generated, not committed)
```

## Download

The latest installer is here: **[Pharmacy POS release zip](https://github.com/TalhaRehman-KHT/pharmacy-pos/releases/latest)**

The zip is password protected. Ask the author for the password.

The installer is not code-signed yet, so Windows SmartScreen shows a warning the first time it runs.
[INSTALL.md](INSTALL.md) explains how to get past it.

## Development setup

You need Windows 10 or 11 (x64), Node.js 22 or newer, and Git.

```sh
git clone REPOSITORY_URL pharmacy-pos
cd pharmacy-pos
npm install
npx electron-builder install-app-deps
```

`install-app-deps` builds the native modules (`better-sqlite3`, `keytar`) for Electron rather than for
your system Node. Run it again after every `npm install` and after every Electron upgrade.

For Google Drive backup, create a `.env` file in the project root with an OAuth client
(see [Google Cloud setup](#google-cloud-setup-for-drive-backup)):

```
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx
```

The app runs without it. The Drive panel in Settings then says Drive backup is not set up.

Start the app:

```sh
npm run electron:dev
```

This runs Vite on port 5173 and opens Electron against it. The first start shows the setup wizard. To
see it again, quit the app and delete `pharmacy.db`, `pharmacy.db-wal` and `pharmacy.db-shm` from
`%APPDATA%\Pharmacy POS`.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run electron:start` | Builds the renderer and runs Electron against `dist/` |
| `npm run lint` | Runs oxlint |
| `npm run dist` | Builds the installer |

Because `better-sqlite3` is built for Electron, scripts that open the database must run through Electron:

```sh
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/db-check.js
```

## Building the installer

1. Put the app icon at `build/icon.ico`. It must be a multi-size `.ico` that includes a 256×256 image.
2. Make sure `.env` holds the Google OAuth client. `npm run dist` packs it into
   `build/drive-credentials.bin` and stops if either value is missing.
3. Set `version` in `package.json`.
4. Build from a clean state:

```sh
rm -rf dist release2
npx electron-builder install-app-deps
npm run lint
npm run dist
```

The installer is written to `release2/Pharmacy POS Setup <version>.exe`. `npm run dist` builds the
renderer, writes the Drive credentials file, then runs electron-builder with `-c.npmRebuild=false`, so
it packs the native modules exactly as `install-app-deps` built them.

The installer lets the user choose the install folder and adds a desktop shortcut. Uninstalling removes
the program only: the database and the Documents folder are kept, and the uninstaller tells the user where
they are (`build/installer.nsh`).

## Google Cloud setup for Drive backup

Drive backup uses one OAuth client for the product, shipped inside every installer. Each owner signs in
with their own Google account, and the app can see only the files it created (scope `drive.file`).

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project, for example
   "Pharmacy POS".
2. Go to **APIs & Services**, then **Library**, and enable the **Google Drive API**.
3. Go to **Google Auth Platform**, then **Branding**, and set the app name, support email and developer
   contact. Under **Audience**, choose **External**.
4. Under **Data Access**, add the scope `https://www.googleapis.com/auth/drive.file`. It is a
   non-sensitive scope, so Google does not require a security assessment for it.
5. Under **Clients**, create a client of type **Desktop app**. Desktop clients accept the loopback
   redirect the app uses (`http://127.0.0.1:<random port>`), so there are no redirect URIs to register.
6. Copy the client ID and secret into `.env` as shown above.
7. Under **Audience**, click **Publish app** before you hand out installers. While the app is in testing,
   only listed test users can sign in, and their access expires after 7 days.

In development the app reads `.env` directly. In a packaged build the client is read from
`drive-credentials.bin` in the app's resources folder. That file is obfuscated, not encrypted: Google
treats a desktop client's secret as non-confidential, and sign-in is protected by PKCE and the loopback
redirect.

Never commit `.env`, `build/drive-credentials.bin` or a downloaded `client_secret*.json`. All three are
in `.gitignore`.

## Where data is stored

| What | Where |
| --- | --- |
| Live database | `%APPDATA%\Pharmacy POS\pharmacy.db` (Electron's `userData` folder) |
| Backups | `Documents\Pharmacy POS\backups` |
| Saved invoice PDFs | `Documents\Pharmacy POS\invoices` |
| Exported CSV reports | `Documents\Pharmacy POS\reports` |
| Google Drive sign-in | Windows Credential Manager |

The database stays out of Documents on purpose. OneDrive often syncs Documents, and syncing a SQLite file
while it is open corrupts it. It also stays out of the install folder, which Windows protects and the
installer replaces on every update. If Documents cannot be written to, backups, invoices and reports go
to `%APPDATA%\Pharmacy POS` instead, and Settings says so.

Owners can open the data folder from **Settings**, under **Data folder**.

## Not included

- No multi-branch support. One installation is one shop, and shops do not share data.
- No online store or customer-facing ordering.
- No payment gateway. Card payments are recorded by slip reference, not processed.
- No code signing yet, so Windows SmartScreen warns on first install.
