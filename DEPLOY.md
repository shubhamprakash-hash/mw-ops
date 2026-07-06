# Monkey Wrench Ops — Deployment Guide

This guide explains how to take the app from a folder on your computer to something your team can actually log into. It's written to be followed start to finish without prior deployment experience.

---

## First, the one thing to understand

This is a **server application**, not a website you upload. It can't go on a plain web host the way a single HTML page would. It needs:

1. A machine that **runs Node.js continuously** (the server process), and
2. **Storage that survives restarts** — your entire database is one file at `data/mw-ops.db`. Everything lives there, including uploaded brief files (attachments are stored *inside* the database, not as loose files). If that file gets wiped, every job, timesheet, attachment, and account is gone.

Point 2 is the part people get wrong. Many "free" cloud tiers erase the filesystem on every restart, which silently destroys your data. The instructions below get this right.

---

## Which route should you pick?

| | Best for | Reachable from | Cost | Difficulty |
|---|---|---|---|---|
| **A. Office machine** | A team in one office | Inside your office network only | Free | Easiest |
| **B. Render** | A team that works remotely / from anywhere | The public internet (a real URL) | ~$7/month | Easy |
| **C. Railway** | Same as Render, alternative | The public internet (a real URL) | ~$5/month | Easy |

If everyone sits in one office, **start with Route A** — it's free, fast, and your data never leaves your premises. Move to B or C only when people need access from home or on the road.

---

## Route A — Run it on an office machine

Pick one computer that stays on during work hours (or a cheap mini-PC). This becomes your server.

### One-time setup

1. **Install Node.js** (version **22 or newer** — the current LTS) from <https://nodejs.org> — download the "LTS" installer and run it. Node 22 matters: the app's fallback database engine (`node:sqlite`) only exists in Node 22.5+, so an older Node can fail to start.
2. Copy the `mw-ops` folder onto the machine and unzip it.
3. Open a terminal **in that folder**:
   - Windows: open the folder, type `cmd` in the address bar, press Enter.
   - Mac: right-click the folder → "New Terminal at Folder".
4. Run:
   ```bash
   npm install
   npm start
   ```
   `npm install` will try to compile **better-sqlite3** (the fast, production-grade database engine). On Windows and Mac it normally installs a prebuilt binary with no fuss. If your machine has no C/C++ build tools and it can't compile, that's fine — the app automatically falls back to Node's built-in SQLite and prints a one-line notice plus an "ExperimentalWarning: SQLite is an experimental feature." That warning is harmless; the app runs the same either way.
5. You should see `Monkey Wrench Ops running → http://localhost:3000`.

### Let the team reach it

1. Find this machine's local IP address:
   - Windows: run `ipconfig`, look for "IPv4 Address" (e.g. `192.168.1.42`).
   - Mac: System Settings → Network, or run `ipconfig getifaddr en0`.
2. Anyone on the same office Wi-Fi/network opens **`http://192.168.1.42:3000`** (use your actual number).
3. Allow the app through the machine's firewall if prompted the first time.

> **Important — don't set `NODE_ENV=production` on a plain office machine.** In production mode the app marks login cookies "secure," meaning the browser only sends them over **HTTPS**. An office machine reached over plain `http://192.168.x.x` has no HTTPS, so logins would appear to succeed and then immediately bounce back to the sign-in screen. On Route A, leave `NODE_ENV` unset (development). The secure-cookie setting is meant for Routes B and C, where the host gives you HTTPS automatically.

### Keep it running reliably

`npm start` stops if you close the terminal or the machine sleeps. To keep it alive:

1. Stop the running server (`Ctrl + C`), then install a process manager once:
   ```bash
   npm install -g pm2
   pm2 start server/index.js --name mw-ops
   pm2 save
   pm2 startup
   ```
   (Run the extra command `pm2 startup` prints, so it relaunches after a reboot.)
2. Set the machine's power settings so it doesn't sleep.

Your database lives in the `data/` folder on this machine — see **Backups** below.

---

## Route B — Deploy to Render (recommended for remote access)

Render deploys from a GitHub repository and handles the server for you. The only paid part you need is a **persistent disk** so your database survives.

### Step 1 — Put the code on GitHub

You need the project in a GitHub repo (this is how Render pulls it).

1. Create a free account at <https://github.com> and click **New repository** → name it `mw-ops` → keep it **Private** → Create.
2. Get the code up there. Easiest non-technical way:
   - Install **GitHub Desktop** (<https://desktop.github.com>).
   - File → Add Local Repository → select your unzipped `mw-ops` folder → Publish.
   - It will skip `node_modules` and the database automatically (the included `.gitignore` handles that).
   - *Or*, if you use the command line:
     ```bash
     cd mw-ops
     git init && git add . && git commit -m "Monkey Wrench Ops"
     git branch -M main
     git remote add origin https://github.com/YOUR-USERNAME/mw-ops.git
     git push -u origin main
     ```

### Step 2 — Create the service on Render

1. Sign up at <https://render.com> and connect your GitHub account.
2. Click **New → Web Service**, pick your `mw-ops` repo.
3. Fill in:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: a **paid** instance (the free one cannot keep a database — see Step 4).

### Step 3 — Set environment variables

In the service's **Environment** section, add:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | a long random string (generate one below) |
| `OFFICE_DOMAIN` | `monkeywrench.in` |
| `DATA_DIR` | `/var/data` |

To generate a strong `JWT_SECRET`, run this on your computer and paste the output:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Don't set `PORT` — Render provides it and the app picks it up automatically.

### Step 4 — Add the persistent disk (do not skip)

1. In the service, open **Disks → Add Disk**.
2. **Mount Path**: `/var/data`  (this must match the `DATA_DIR` value above).
3. Size: 1 GB comfortably holds the database for a typical agency. Because uploaded brief files are kept **inside** the database (capped at 12 MB each), heavy attachment use will grow it — bump the disk to 5–10 GB if your team uploads a lot of large files.

This is what keeps your database alive across restarts and redeploys. Without it, Render's filesystem is wiped on every restart and you lose everything.

### Step 5 — Launch

Click **Create / Deploy**. After a couple of minutes you'll get a URL like `https://mw-ops.onrender.com`. Open it, sign in as `sanjay@monkeywrench.in` / `changeme123`, and change the password.

---

## Route C — Deploy to Railway (alternative)

Very similar to Render.

1. Put the code on GitHub (same as Route B, Step 1).
2. Sign up at <https://railway.com>, **New Project → Deploy from GitHub repo**, pick `mw-ops`. Railway auto-detects Node and builds it.
3. In the service **Settings → Networking**, click **Generate Domain** to get a public URL.
4. In **Variables**, add `NODE_ENV=production`, `JWT_SECRET=...`, `OFFICE_DOMAIN=monkeywrench.in`, and `DATA_DIR=/var/data`.
5. In **Settings → Volumes**, add a volume mounted at `/var/data`.
6. Redeploy. Open the generated URL and sign in.

For an always-on service Railway runs about $5/month; its free credit isn't enough to keep something online around the clock.

---

## Environment variables (reference)

| Variable | What it does | Local default |
|---|---|---|
| `PORT` | Port the server listens on (cloud hosts set this for you) | `3000` |
| `JWT_SECRET` | Signs login sessions — **change it in production** | dev placeholder |
| `OFFICE_DOMAIN` | Only emails on this domain can sign in | `monkeywrench.in` |
| `SEED_PASSWORD` | First-run password for seeded accounts | `changeme123` |
| `DATA_DIR` | Folder holding the database file | the app's `data/` folder |
| `NODE_ENV` | `production` enables secure (HTTPS-only) cookies — use on Routes B/C, **not** on a plain-HTTP office machine | `development` |
| `DB_ENCRYPTION_KEY` | If set, encrypts the whole database at rest (SQLCipher). Keep it safe — see the encryption section | unset (unencrypted) |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `SMTP_FROM` | Optional mail server for the Super-Admin "reset by email" code. If unset, the code is logged to the server console | unset (code logged) |

---

## Data management (Super Admins)

The **Data** section (Super Admins only) is a self-serve console for the whole dataset:

- **Export** — download the jobs dataset as **CSV or JSON**, filtered by **all time, a year, or a month**; or take a **full backup** (a complete JSON snapshot of every table, used for restore).
- **Restore** — upload a previously downloaded full backup to replace the current database (wrapped in a transaction; it rolls back if the file is malformed).
- **Reset** — two options: *Reset to zero* clears all operational data (jobs, timesheets, approvals, issues, activity) while keeping your people, clients and setup, so every count and financial returns to zero; *Wipe everything* removes all data except the Super Admin logins, so you can sign back in and rebuild from scratch. Neither loads sample data.

Take a full backup before any restore or reset — these overwrite data and can't be undone.

## Custom fields (Super Admins)

Under **Masters → Custom fields**, Super Admins can **add**, **rename**, hide, or **remove** fields on jobs and clients (text, number, date, select, or long-text). Added fields appear on the relevant form immediately and flow into exports. Renaming keeps existing data (the underlying key never changes); removing a field deletes its stored values.

## Database encryption at rest (optional)

By default the database file is unencrypted. To encrypt the **entire** database transparently — so reports, sums, and date filters keep working unchanged — set **`DB_ENCRYPTION_KEY`** to a long secret. The app then opens the file with SQLCipher via the optional `better-sqlite3-multiple-ciphers` module (bundled as an optional dependency; it installs automatically when it can build).

Important cautions:

- **Guard the key.** Without it the database cannot be opened. Store it in your host's secret manager, not in the repo.
- **The key can't be changed on an existing file.** To rotate it: export a full backup, set the new key on an empty database (reset), then restore.
- If the key is set but the cipher module isn't available, the app logs a clear warning and runs **unencrypted** rather than failing — check the startup log to confirm encryption is `ON`.

## Resetting a forgotten password

Two paths, no self-service reset for ordinary accounts:

- **Anyone** — a Super Admin or Admin opens **Users**, clicks the key icon, and hands over the temporary password the app generates. The person sets their own at next sign-in. No email needed.
- **Super Admins** — can self-serve from the login screen via **"reset by email."** The app emails a **6-digit code** (valid 15 minutes) to the Super Admin's address; they enter it with a new password. If SMTP isn't configured, the code is written to the server log instead, so the flow still works everywhere. Configure the `SMTP_*` variables to send real email.

---

## Going to production safely (Routes B & C)

A short pre-flight before you let people in:

- [ ] **`JWT_SECRET`** set to a long random string (not the placeholder). Changing it later logs everyone out — fine, but expected.
- [ ] **`NODE_ENV=production`** so login cookies are secure. Render and Railway terminate HTTPS for you, so this is correct there.
- [ ] **`OFFICE_DOMAIN`** matches your real email domain (this is what login is restricted to).
- [ ] **Persistent disk/volume** attached and `DATA_DIR` pointing at it (see each route's steps).
- [ ] First login done as a Super Admin and the **default password changed**. There are two seeded Super Admins — `sanjay@` and `pawas@monkeywrench.in` — change both.
- [ ] Optionally rotate `SEED_PASSWORD` before first run, though everyone is force-changed at first sign-in anyway.

A note on the access model so you're not surprised: **financial figures (billing, cost, P&L, all reports) are visible only to Super Admins.** Admins run the operational side (jobs, masters, users) but see no money unless a Super Admin explicitly grants them the "view financials" capability in **Permissions**.

---

## Backing up your data

Your whole system is one file: `mw-ops.db` (inside `data/`, or inside `DATA_DIR` on a cloud host). Because attachments live inside it too, copying this one file backs up everything — jobs, timesheets, accounts, and uploaded files alike.

- **Office machine (Route A):** copy the `data/` folder somewhere safe on a schedule — a shared drive, a backup tool, anything. That copy is a full restore point.
- **Render / Railway:** the persistent disk is durable, but still take periodic copies. Use the host's shell/console to download `mw-ops.db`, or set up a scheduled copy. Render's disks also take automatic daily snapshots.

Test a restore once so you know it works before you rely on it.

---

## Updating the app later

When the code changes:

- **Office machine:** replace the files (keep your `data/` folder), then `npm install` and restart (`pm2 restart mw-ops`).
- **Render / Railway:** push the new code to GitHub — the host redeploys automatically. Your data on the persistent disk is untouched.

The database is never overwritten by a deploy; it only changes as people use the app.

---

## About "office email" login

Right now login is **email + password**, restricted to your `@monkeywrench.in` domain. That satisfies "everyone uses their office email," but it's a separate password from their actual email account.

For true single sign-on — where people click "Sign in with Google/Microsoft" and use their real work account — the login step needs to be wired to your company's identity provider (Google Workspace or Microsoft 365). That requires configuration only your IT/Workspace administrator can do (registering the app, client IDs, allowed domains). The rest of the system — roles, approvals, the timesheet gate — stays exactly the same. This is the one piece that can't be set up without your organization's account access; ask your IT admin, or I can prepare the integration code for them to plug those values into.

---

## Troubleshooting

- **"Cannot find module 'express'"** — you didn't run `npm install` in the project folder.
- **Login succeeds then immediately returns to the sign-in screen** — you've set `NODE_ENV=production` while serving over plain `http://` (typically a Route A office machine). Secure cookies require HTTPS; unset `NODE_ENV` (or use a host that provides HTTPS) and try again.
- **"ExperimentalWarning: SQLite is an experimental feature"** — harmless. It just means better-sqlite3 didn't compile on this machine and the app is using Node's built-in SQLite instead. Everything works; the data format is identical. To silence it, install build tools so better-sqlite3 can compile, or ignore it.
- **Login says "Use your office email"** — the email doesn't end in `@monkeywrench.in`. Change `OFFICE_DOMAIN` if your real domain differs, then re-seed.
- **Someone forgot their password** — a Super Admin or Admin resets it from **Users** (the key icon). Super Admins can also self-serve via **"reset by email"** on the login screen (a 6-digit code, emailed or logged if SMTP is unset).
- **Data disappeared after a redeploy (cloud)** — the persistent disk/volume isn't attached, or `DATA_DIR` doesn't match the mount path. Both must point to the same folder.
- **Teammates can't reach the office machine** — they must be on the same network, the machine's firewall must allow the port, and you must use the machine's IP, not `localhost`.
- **Node version errors / won't start on an old Node** — install **Node 22 or newer**; the built-in database fallback needs 22.5+.

---

## Quick checklist

- [ ] Node.js installed (**22 or newer**)
- [ ] `npm install` run successfully
- [ ] App starts and you can log in locally
- [ ] (Cloud) Code pushed to a private GitHub repo
- [ ] (Cloud) `JWT_SECRET` set to a long random string
- [ ] (Cloud) `NODE_ENV=production` set (Routes B/C only — never on a plain-HTTP office machine)
- [ ] (Cloud) Persistent disk/volume attached and `DATA_DIR` points to it
- [ ] First login done and the default password changed for **both** Super Admins
- [ ] A backup of `data/` is in place
