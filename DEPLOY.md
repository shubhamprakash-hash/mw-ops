# Monkey Wrench Ops — Deployment Guide

This guide explains how to take the app from a folder on your computer to something your team can actually log into. It's written to be followed start to finish without prior deployment experience.

---

## First, the one thing to understand

This is a **server application**, not a website you upload. It can't go on a plain web host the way a single HTML page would. It needs:

1. A machine that **runs Node.js continuously** (the server process), and
2. **Storage that survives restarts** — your entire database is one file at `data/mw-ops.db`. If that file gets wiped, every job, timesheet, and account is gone.

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

1. **Install Node.js** (version 20 or newer) from <https://nodejs.org> — download the "LTS" installer and run it.
2. Copy the `mw-ops` folder onto the machine and unzip it.
3. Open a terminal **in that folder**:
   - Windows: open the folder, type `cmd` in the address bar, press Enter.
   - Mac: right-click the folder → "New Terminal at Folder".
4. Run:
   ```bash
   npm install
   npm start
   ```
5. You should see `Monkey Wrench Ops running → http://localhost:3000`.

### Let the team reach it

1. Find this machine's local IP address:
   - Windows: run `ipconfig`, look for "IPv4 Address" (e.g. `192.168.1.42`).
   - Mac: System Settings → Network, or run `ipconfig getifaddr en0`.
2. Anyone on the same office Wi-Fi/network opens **`http://192.168.1.42:3000`** (use your actual number).
3. Allow the app through the machine's firewall if prompted the first time.

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
3. Size: 1 GB is plenty.

This is what keeps your database alive across restarts and redeploys. Without it, Render's filesystem is wiped on every restart and you lose everything.

### Step 5 — Launch

Click **Create / Deploy**. After a couple of minutes you'll get a URL like `https://mw-ops.onrender.com`. Open it, sign in as `founder@monkeywrench.in` / `changeme123`, and change the password.

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
| `NODE_ENV` | Set to `production` on a live host (enables secure cookies) | `development` |

---

## Backing up your data

Your whole system is one file: `mw-ops.db` (inside `data/`, or inside `DATA_DIR` on a cloud host).

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
- **Login says "Use your office email"** — the email doesn't end in `@monkeywrench.in`. Change `OFFICE_DOMAIN` if your real domain differs, then re-seed.
- **Data disappeared after a redeploy (cloud)** — the persistent disk/volume isn't attached, or `DATA_DIR` doesn't match the mount path. Both must point to the same folder.
- **Teammates can't reach the office machine** — they must be on the same network, the machine's firewall must allow the port, and you must use the machine's IP, not `localhost`.
- **Node version errors** — install Node 20 or newer (22+ recommended).

---

## Quick checklist

- [ ] Node.js installed (20+)
- [ ] `npm install` run successfully
- [ ] App starts and you can log in locally
- [ ] (Cloud) Code pushed to a private GitHub repo
- [ ] (Cloud) `JWT_SECRET` set to a long random string
- [ ] (Cloud) Persistent disk/volume attached and `DATA_DIR` points to it
- [ ] First login done and the default password changed
- [ ] A backup of `data/` is in place
