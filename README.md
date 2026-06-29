# Monkey Wrench Ops

A multi-user job, timesheet, approval, and P&L console for the studio. Real backend, real login, role-based access. Built with Node + Express + SQLite on the server and a plain (no-build) JavaScript single-page app on the front end.

---

## What it does

- **Office-email login** for everyone. Only `@monkeywrench.in` addresses can sign in.
- **Four roles** with different visibility (see table below).
- **Job board** grouped by stage (Pipeline → Pending → Studio → Review → Done → Approved).
- **Timesheets** — each person logs hours against the jobs they're assigned, then *submits the day*.
- **The timesheet gate** — if you don't submit a day's timesheet, your next day's job list stays locked until you do.
- **Three-step approval** — a finished job + its timesheet is signed off by the team lead → then an Admin → then the Super Admin.
- **Money** (billing, manpower cost, profit, margin, P&L) is visible **only** to Admins and Super Admins. Team leads and members never see it.
- **Backend** (user management, rates, dashboard, P&L) is reachable **only** by Admin and Super Admin.

---

## Who sees what

| Capability | Super Admin | Admin | Team Lead | Member |
|---|:---:|:---:|:---:|:---:|
| See & edit everything | ✅ | ✅ | — | — |
| Backend (users, rates) | ✅ | ✅ | — | — |
| Billing / Profit & Loss | ✅ | ✅ | ❌ hidden | ❌ hidden |
| Assign tasks to members | ✅ | ✅ | ✅ (own team) | — |
| Approve finished work | ✅ (final) | ✅ (2nd) | ✅ (1st, own team) | — |
| Create users | ✅ (any role) | ✅ (lead/member only) | — | — |
| Log time & submit day | ✅ | ✅ | ✅ | ✅ |
| Timesheet gate applies | exempt | exempt | ✅ | ✅ |

---

## Requirements

- **Node.js 20 or newer** (Node 22.5+ recommended — it ships a built-in SQLite that the app can fall back to, so it runs even without a native build).

## Setup & run

```bash
cd mw-ops
npm install
npm start
```

Then open **http://localhost:3000**.

On first launch the database is created and seeded automatically at `data/mw-ops.db`.

> **About the database driver:** the app uses `better-sqlite3` when it installs cleanly (it's listed as an *optional* dependency). If that native module can't build on your machine, the app automatically falls back to Node's built-in SQLite — no action needed either way.

To wipe and re-seed at any time:

```bash
npm run seed
```

---

## Seeded accounts

Every account's password is **`changeme123`** and must be changed on first sign-in.

| Email | Role | Team |
|---|---|---|
| `founder@monkeywrench.in` | Super Admin | — |
| `ops@monkeywrench.in` | Admin | — |
| `shivani@monkeywrench.in` | Team Lead | Hornet |
| `adrija@monkeywrench.in` | Team Lead | Raptor |
| `saddam@monkeywrench.in` | Team Lead | Studio |
| `kusumanjan@`, `avishek@`, `anwesa@`, `shreyasi@`, `prakash@` | Member | Hornet |
| `srinjani@`, `pronay@`, `aritra@`, `tiyash@`, `mrinmoyee@` | Member | Raptor |
| `gaurab@`, `rahul@`, `sanu@` | Member | Studio |

The jobs from the 11-May sheet are pre-loaded, with several Studio jobs deliberately parked at different points in the approval chain so you can watch the workflow move. Sign in as `saddam@` to see the lead's approval queue, then `ops@`, then `founder@` to walk a job all the way to **Approved**.

---

## How the two key rules work

**Timesheet gate.** Before showing a non-admin their job list for today, the server checks the most recent past day on which they had assigned work. If they never *submitted* that day's timesheet, the job list returns locked (HTTP 423) and the app shows a "submit your timesheet for `<date>`" screen. Submitting that day unlocks the list.

**Approval chain.** When an assignee marks a job done and hits *Submit for approval*, the job enters `submitted`. The respective team lead sees it in their queue and approves → `lead_approved`. An Admin approves → `admin_approved`. The Super Admin approves → `approved` and the job moves to the **Approved** stage. Anyone in the chain can **reject** with a note, which sends the job back to **Pending** for rework.

---

## A few honest notes

- **Billing amounts and hourly rates are placeholders.** Cost = logged hours × each person's rate; profit = billing − cost. Set real numbers in **Backend · Users** (rates) and on each job (billing) and every dashboard/P&L figure recalculates. Seeded margins look very high simply because little time has been logged yet.
- **Login is email + password**, restricted to your office domain. For *true* "sign in with your office account" (Google Workspace / Microsoft 365 single sign-on), swap the `/api/login` handler in `server/index.js` for an OAuth flow with your provider — the role model and everything else stays the same. That step needs your company's identity-provider configuration, which only your IT/Workspace admin can set up.
- This is the application source. **Running it on a shared server so the whole team can reach it is a deployment step** (see below) that has to happen on infrastructure you control.

---

## Deploying for the team

1. Put the folder on a server (a small cloud VM, or a host like Render / Railway / Fly.io).
2. Set environment variables (see `.env.example`) — especially a strong `JWT_SECRET` and `NODE_ENV=production`.
3. Serve it over **HTTPS** (secure cookies switch on in production).
4. Back up the `data/` folder — that single SQLite file is your whole database.

---

## Project layout

```
mw-ops/
├── server/
│   ├── index.js          Express app + auth endpoints + static serving
│   ├── db.js             Schema, roles/workflow constants, seed data
│   ├── sqlite.js         DB driver adapter (better-sqlite3 → node:sqlite fallback)
│   ├── auth.js           Login, JWT, password change
│   ├── middleware.js     requireAuth / requireAdmin / the timesheet gate
│   ├── helpers.js        Job serialization (hides money by role), cost math
│   └── routes/
│       ├── jobs.js        Board, my-jobs (gated), assign, stage, submit
│       ├── timesheets.js  Log time, submit-day, gate status
│       ├── approvals.js   Role-filtered queue + approve/reject
│       ├── people.js      Assignable members (no rates exposed)
│       └── admin.js       Users CRUD, rates, dashboard, P&L (admin-only)
├── public/               Front-end SPA (index.html, app.js, styles.css)
├── data/                 SQLite database (created on first run)
├── .env.example
└── package.json
```

## Tech

Node.js, Express, SQLite (better-sqlite3 / node:sqlite), bcryptjs for password hashing, JSON Web Tokens in an http-only cookie for sessions. No build step, no front-end framework.
