# Monkey Wrench Ops 2.0

A multi-user **job, timesheet, approval, and P&L console** for the studio. Real backend, real login, role-based access. Node + Express + SQLite on the server; a plain (no-build) JavaScript single-page app on the front end.

Version 2.0 adds the **Masters** layer (business verticals, teams, departments, clients), **dated cost rates** with full history preservation, a **presentation mode**, and a stricter money model: **financials are now Super-Admin-only**.

---

## What it does

- **Office-email login** for everyone — only `@monkeywrench.in` addresses can sign in (domain configurable).
- **Four roles** with different visibility (see table below).
- **Job board** grouped by stage (Pipeline → Pending → Studio → Review → Done → Approved).
- **Structured job numbers** — every job is auto-numbered `Year / Client No / Job No / R{round}` (e.g. `2026/0003/07/R1`) with an auto job date. The **round** bumps (R1 → R2 …) when a job comes back for rework after client feedback, via a one-click "New round".
- **Job detail** — open any job to manage **sub-tasks** (checklist with assignees), **file attachments** (briefs/PDFs uploaded and downloaded in-app), a **brief version history** (every revision kept), a **delivery date**, and a configurable **workflow stage** (Strategy / Copy / Art / Artworking, extensible).
- **Notifications** — an in-app bell alerts people when they're assigned a job, when work needs their approval, and when a job is approved or sent back.
- **Masters** — maintain business **verticals** (e.g. Digital, Mainline), **teams** (with a lead, members, and the ability to move members between teams), **departments** (reporting structure), **clients** (project or retainership; converted or prospective), and **workflow stages**.
- **Timesheets** — each person logs hours against the jobs they're assigned, then *submits the day*.
- **The timesheet gate** — if you don't submit a day's timesheet, your next day's job list stays locked until you do.
- **Three-step approval** — a finished job + its timesheet is signed off by the team lead → then an Admin → then a Super Admin.
- **Dated cost rates** — every person's hourly cost is stored with an *effective-from* date. When a rate changes you add a new dated rate; **old jobs keep costing at the rate that was in effect on the day the work was done.** History is never overwritten.
- **Money** (billing, manpower cost, profit, margin, dashboards, P&L) is visible **only to Super Admins**.
- **Reporting (Super-Admin)** — every dashboard and report can be filtered by **vertical** and by **period** (this month, a year, or since inception). A **Team Bandwidth** report shows available vs logged hours and utilisation per person; **Year-on-Year** compares billing, cost, profit and margin across years with a project-vs-retainership split; and **P&L** can be sliced by client, job or vertical and by client type. All financials run on the dated-cost engine, so historical numbers never shift.
- **Multiple teams per job** — a job can belong to several teams at once (picked by checkbox), and every lead of any of those teams sees it on their board and in their approval queue.
- **Issues & blockers** — anyone on a job can raise a blocker, issue or note against it, assign an owner, and resolve it; open blockers show as a red flag on the board, and leads and assignees are notified.
- **Activity log (audit trail)** — an immutable, append-only record of who did what and when, across job creation, edits, assignments, stage and round changes, submissions, approvals, sub-tasks, attachments and issues. It's filterable by person, action and date, and each job has its own activity timeline.
- **Granular permissions** — roles carry sensible defaults, and a Super Admin can additionally **grant** a capability to a specific person (for example, give one trusted admin financial visibility, or let a member **create & assign jobs**) or **revoke** a default — per person, from a single screen.
- **Admin-managed password resets** — a Super Admin or Admin issues a temporary password from Users; the person changes it at next sign-in. Everyone must change the seeded default on first login.
- **Super-Admin reset by email** — a Super Admin who's locked out can request a **6-digit code** from the login screen; it's emailed (or logged, if SMTP isn't set) and used with a new password. Valid 15 minutes, single-use.
- **Data management (Super-Admin)** — export the jobs dataset as **CSV or JSON**, filtered by **all / year / month**; take a **full JSON backup**; **restore** from a backup; **reset to zero** (clear all jobs, timesheets and activity while keeping people, clients and setup); or **wipe everything** (remove all data except the Super Admin logins). A live count of every table is shown.
- **Custom fields (Super-Admin)** — under Masters, **add / rename / hide / remove** fields (text, number, date, select, long-text) on **jobs and clients**. New fields appear on the form at once and flow into exports; renaming preserves data.
- **Database encryption at rest (optional)** — set `DB_ENCRYPTION_KEY` to encrypt the whole database transparently with SQLCipher; reports and filters keep working. Falls back to unencrypted (with a clear log line) if the key or cipher module is absent.
- **Presentation mode** — a Super Admin can toggle all monetary figures off-screen for screen-shares and demos.

---

## Who sees what

| Capability | Super Admin | Admin | Team Lead | Member |
|---|:---:|:---:|:---:|:---:|
| Billing / cost / Profit & Loss / dashboards | ✅ | ❌ hidden | ❌ hidden | ❌ hidden |
| Backend — Masters (verticals, teams, departments, clients) | ✅ | ✅ | — | — |
| Backend — User management | ✅ (any role) | ✅ (lead/member only) | — | — |
| Set a client's **retainership cost** | ✅ | ✅ (can set, can't view reports) | — | — |
| View / edit **cost rates** & rate history | ✅ | ❌ | — | — |
| Create jobs & assign to members | ✅ | ✅ | ✅ | grantable |
| Assign tasks to members | ✅ | ✅ | ✅ (own teams) | grantable |
| Approve finished work | ✅ (final) | ✅ (2nd) | ✅ (1st, own teams) | — |
| Log time & submit day | ✅ | ✅ | ✅ | ✅ |
| Timesheet gate applies | exempt | exempt | ✅ | ✅ |
| Presentation-mode toggle | ✅ | — | — | — |

> **The key 2.0 change:** Admins run the operational backend (masters, users, assignments, approvals) but **no longer see any money**. All financial visibility — billing, cost, profit, margin, dashboards and P&L — is reserved for Super Admins. An Admin *can* enter a client's retainership cost, but cannot open any financial report.

---

## Requirements

- **Node.js 20 or newer** (Node 22.5+ recommended — it ships a built-in SQLite the app can fall back to, so it runs even without a native build).

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

Every account's password is **`changeme123`** and must be changed on first sign-in. (Sign-in still works on the first login; you're simply prompted to set a new password.)

| Email | Role | Team |
|---|---|---|
| `sanjay@monkeywrench.in` | Super Admin | — |
| `pawas@monkeywrench.in` | Super Admin | — |
| `ops@monkeywrench.in` | Admin | — |
| `shivani@monkeywrench.in` | Team Lead | Hornet |
| `adrija@monkeywrench.in` | Team Lead | Raptor |
| `saddam@monkeywrench.in` | Team Lead | Studio |
| 13 members across Hornet, Raptor and Studio | Member | (their team) |

Sample data includes two business **verticals** (Digital, Mainline), three **teams**, four **departments**, ten **clients** (one of them a *prospective* client), and the jobs sheet pre-loaded with several jobs parked at different points in the approval chain so you can watch the workflow move. Cost rates are seeded in **three dated tiers** (a 2025 baseline, a 2026 base, and a June-2026 raise for two people), and a handful of **2025 jobs** are included so the **Year-on-Year** report and period filters have a previous year to compare. Because costs are dated, a job worked in May-2026 keeps its old rate after the June rise, and 2025 jobs cost at the 2025 tier.

To walk a job all the way to **Approved**, sign in as `saddam@` (lead queue) → `ops@` (admin approval) → `sanjay@` (final approval).

---

## How the key rules work

**Timesheet gate.** Before showing a non-admin their job list for today, the server checks the most recent past day on which they had assigned work. If they never *submitted* that day's timesheet, the job list returns locked (HTTP 423) and the app shows a "submit your timesheet for `<date>`" screen. Submitting that day unlocks the list.

**Approval chain.** When an assignee marks a job done and hits *Submit for approval*, the job enters `submitted`. The team lead sees it in their queue and approves → `lead_approved`. An Admin approves → `admin_approved`. A Super Admin approves → `approved` and the job moves to the **Approved** stage. Anyone in the chain can **reject** with a note, sending the job back to **Pending** for rework.

**Dated cost rates (historical integrity).** A person's cost rate is a list of `(rate, effective_from)` records, not a single number. The cost of a job is the sum, over its timesheet entries, of `hours × the rate that was effective on that entry's work date`. Raising someone's rate adds a new dated record and leaves every past calculation untouched — so historical P&L never silently shifts. Rates and their history are visible to Super Admins only, under **Backend · Users**.

**Password resets.** No self-service reset for ordinary accounts — a Super Admin or Admin resets anyone from **Backend · Users** (the key icon), which issues a temporary password; the person sets their own at next sign-in. **Super Admins** additionally have a **"reset by email"** link on the login screen that sends a 6-digit code (valid 15 minutes) to their address — configure `SMTP_*` to send real email, otherwise the code is written to the server log.

**Database encryption.** Set `DB_ENCRYPTION_KEY` to a long secret to encrypt the entire database file at rest (SQLCipher, via the optional `better-sqlite3-multiple-ciphers` module). It's transparent — every query, sum and date filter works unchanged. The key can't be changed on an existing file; to rotate it, export a backup from **Data**, reset with the new key, then restore. Left unset, the app runs unencrypted.

---

## A few honest notes

- **Billing amounts and hourly rates are placeholders.** Cost = logged hours × each person's *dated* rate; profit = billing − cost. Set real numbers in **Backend · Users** (rates) and on each job (billing) and every dashboard/P&L figure recalculates. Seeded margins look very high simply because little time has been logged yet.
- **Login is email + password**, restricted to your office domain. For *true* "sign in with your office account" (Google Workspace / Microsoft 365 SSO), swap the `/api/login` handler in `server/index.js` for an OAuth flow with your provider — the role model and everything else stays the same. That step needs your company's identity-provider configuration, which only your IT/Workspace admin can set up.
- This is the application source. **Running it on a shared server so the whole team can reach it is a deployment step** (below) that has to happen on infrastructure you control.

---

## Deploying for the team

1. Put the folder on a server (a small cloud VM, or a host like Render / Railway / Fly.io).
2. Set environment variables (see `.env.example`) — especially a strong `JWT_SECRET` and `NODE_ENV=production`.
3. Serve it over **HTTPS** (secure cookies switch on in production).
4. Back up the `data/` folder — that single SQLite file is your whole database.

See `DEPLOY.md` for a step-by-step walkthrough.

---

## Project layout

```
mw-ops/
├── server/
│   ├── index.js          Express app + auth/public endpoints + static serving
│   ├── db.js             Schema, roles/workflow constants, seed data
│   ├── sqlite.js         DB driver adapter (SQLCipher if keyed → better-sqlite3 → node:sqlite)
│   ├── auth.js           Login, JWT, password change, Super-Admin emailed-code reset
│   ├── mailer.js         Optional SMTP send for the reset code (logs it if SMTP unset)
│   ├── middleware.js     requireAuth / requireBackend / requireSuper / requireCap / timesheet gate
│   ├── helpers.js        Job serialization (hides money by role), dated-rate cost math, custom-field values
│   └── routes/
│       ├── jobs.js        Board, my-jobs (gated), assign, submit, rounds, sub-tasks, attachments, brief versions, multi-team
│       ├── timesheets.js  Log time, submit-day, gate status
│       ├── approvals.js   Role-filtered queue + approve/reject
│       ├── people.js      Assignable members (no rates exposed)
│       ├── issues.js      Issue / blocker tracking per job                          [auth]
│       ├── customfields.js Add/rename/remove custom fields; read for forms          [read: auth, write: super]
│       ├── masters.js     Verticals, teams, departments, clients, workflow stages    [manage_masters]
│       ├── notifications.js The notification bell feed                              [auth]
│       ├── activity.js    The immutable audit trail (filterable)                    [view_activity]
│       ├── permissions.js Per-user capability grants                                [super only]
│       ├── data.js        Export / backup / restore / reset                        [super only]
│       ├── users.js       Users CRUD + dated rates & history                       [manage_users]
│       └── finance.js     Dashboard, P&L, team bandwidth, year-on-year (period-aware) [view_finance]
├── public/               Front-end SPA (index.html, app.js, styles.css)
├── data/                 SQLite database (created on first run)
├── .env.example
└── package.json
```

## Tech

Node.js, Express, SQLite (better-sqlite3 / node:sqlite), bcryptjs for password hashing, JSON Web Tokens in an http-only cookie for sessions. No build step, no front-end framework.
