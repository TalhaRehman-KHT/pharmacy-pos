# Pharmacy POS: setup guide for the shop owner

This guide takes you from the installer file to selling, and shows you how to keep your records safe.

Pharmacy POS runs on one Windows computer in your shop. It does not need the internet. Your sales, stock
and staff accounts are stored on that computer and nowhere else.

---

## 1. Install

1. Double-click **Pharmacy POS Setup 1.0.0.exe**.
2. Windows may show a blue box that says **"Windows protected your PC"**. See the next section.
3. Choose who the program is for. **Only for me** is fine for a single shop computer.
4. Keep the suggested folder and click **Install**.
5. When it finishes, open **Pharmacy POS** from the desktop shortcut or the Start menu.

### The "Windows protected your PC" warning

Windows shows this warning for any program it has not seen many times before. It does not mean the
program is harmful. Programs only skip the warning when the maker has bought a paid digital certificate.

To continue:

1. Click **More info**.
2. Check that the app name is **Pharmacy POS Setup**.
3. Click **Run anyway**.

You only see this once, when you install.

If you did not get the installer directly from the person who sold you the software, do not run it.
Ask them for a fresh copy.

---

## 2. First-time setup

The first time Pharmacy POS opens, it asks for two things.

**Step 1: Shop details.** Your shop name, address, phone and licence number, which are printed on every
receipt. The **invoice prefix** is the first part of each bill number, for example `INV-20261029-0001`.
You can change all of these later in **Settings**.

**Step 2: Owner account.** This is your account. Choose a username and a password of at least
6 characters, then click **Create shop account**.

**Step 3: Recovery code.** The app shows a code like `7K2M-QX9D-4HTR-B06W`. This code is the only way
back into the owner account if you forget your password. Click **Print**, or write it down, and keep it
somewhere safe away from the computer, such as a locked drawer at home. Tick **I have saved this code**
to continue.

You are then signed in.

**Keep your password and recovery code safe.** Nobody can get you back into the owner account without the
recovery code, not even the seller of this software. That is deliberate: if there were another way in,
anyone with access to the shop computer could use it.

### If you forget the owner password

1. On the sign-in screen, click **Forgot password?**.
2. Enter your owner username and your recovery code, then choose a new password.
3. The app gives you a **new** recovery code. The old one stops working. Save the new one the same way.

After 5 wrong codes, recovery is locked for 15 minutes.

To replace a lost or exposed code while you can still sign in, go to **Settings**, then
**Owner recovery code**, and click **Generate new recovery code**. It asks for your current password first,
so nobody can make a new code just because you left the app signed in.

---

## 3. Create accounts for your staff

Each salesman should have their own account, so you can see who made each sale.

1. Sign in as the owner.
2. Click **Users** in the top bar.
3. Click **Add salesman**. Enter a username and a password, then click **Add salesman**.
4. Give the salesman their username and password.

A salesman can sell, add stock and look up medicines. They cannot see Reports, Users or Settings, so
your takings and profit margins stay private.

- **Forgotten password:** in **Users**, click **Reset password** next to their name.
- **Someone leaves:** click **Deactivate**. They can no longer sign in, and their past sales stay on record.

The sign-in screen has no "create account" button on purpose. If it had one, anyone at the counter could
make themselves an owner. Only you can add accounts.

---

## 4. Backups

A backup is a copy of all your records: medicines, stock, sales and accounts. If the computer breaks or
the data gets damaged, a backup lets you get everything back.

### Automatic backups

Pharmacy POS backs up by itself:

- every 6 hours while it is open
- every time you close it

You do not need to do anything for this.

### Take a backup yourself

1. Go to **Settings** and scroll down to **Backup**.
2. Click **Back up now**.

Take one before anything risky, such as moving to a new computer.

### Where the backups are

Backups, saved invoices and exported reports are in this folder:

```
Documents\Pharmacy POS
```

In **Settings**, under **Data folder**, click **Open data folder** to go straight there.

**Copy the `backups` folder to a USB stick every week** and keep the stick away from the shop. If the
computer is stolen or catches fire, a backup on that same computer is lost with it.

---

## 5. Back up to Google Drive (optional)

This keeps a copy of your backups in your own Google account, away from the shop. It needs an internet
connection only while it uploads.

### Connect

1. Go to **Settings**, then **Backup**, then **Google Drive**.
2. Click **Connect Google Drive**. Your web browser opens.
3. Sign in with your Google account and click **Allow**.
4. Go back to Pharmacy POS. It now shows **Connected as** and your email address.

Pharmacy POS can only see the files it puts in Drive, in a folder called **PharmacyPOS**. It cannot see
your other files.

### Upload

Click **Upload latest backup**. Pharmacy POS does not upload on its own, so do this regularly. Once a day
when you close the shop is a good habit.

### Disconnect

Click **Disconnect**. The backups already in your Drive stay there.

---

## 6. Restore a backup

Restoring **replaces all current records** with the ones in the backup. Any sales made after that backup
was taken are lost. Only restore when you need to, for example after the data was damaged or on a new
computer.

Before every restore, Pharmacy POS automatically saves a copy of your current records. If you restore the
wrong backup, you can restore that copy to undo it. It is listed with the tag **before restore**.

### From the list on this computer

1. Go to **Settings**, then **Backup**.
2. Find the backup by its date and click **Restore**.
3. Type **RESTORE** in capital letters and click **Restore and restart**.

The app closes and opens again with the restored records.

### From a file (for example a USB stick)

1. Go to **Settings**, then **Backup**, and click **Restore from file…**.
2. Pick the backup file. Its name looks like `pharmacy-2026-10-29-1830.db.gz`.
3. Type **RESTORE** and click **Restore and restart**.

### From Google Drive

1. Go to **Settings**, then **Backup**, then **Google Drive**, and click **Show Drive backups**.
2. Click **Restore** next to the one you want.
3. Type **RESTORE** and click **Restore and restart**.

### Moving to a new computer

1. On the old computer, click **Back up now**, then copy the newest file from `Documents\Pharmacy POS\backups`
   to a USB stick. You can upload it to Google Drive instead.
2. Install Pharmacy POS on the new computer.
3. The setup screen appears. Fill it in with any details: the restore will replace them.
4. Restore the backup from the USB stick (**Restore from file…**) or from Google Drive.
5. After the restart, sign in with your **old** username and password.

### If the app says the database could not be opened

This means the records on this computer are damaged. Click **Restore from backup…** and pick the most
recent backup from `Documents\Pharmacy POS\backups`. The damaged files are kept in
`backups\damaged` in case they are needed later.

---

## 7. Uninstalling and updating

**Updating:** run the new installer. Your records stay as they are.

**Uninstalling** removes the program but **not your records**. They stay in:

- `Documents\Pharmacy POS` (backups, invoices, reports)
- the program's own data folder (the records themselves)

If you install Pharmacy POS again, it opens with all your data. Only delete those folders yourself if you
are completely sure you will never need the records again.

---

## Two shops?

One installation is for one shop. For a second shop, install Pharmacy POS on that shop's computer. It
gets its own records, owner account and staff accounts, kept separate from the first shop.
