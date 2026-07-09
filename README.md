# LeadHive

**LeadHive** is a lead-management CRM backend built for sales teams who live and die by their pipeline. It handles the full lifecycle of a lead — from the moment it's captured or imported, through assignment, follow-up, conversion, and eventually automated retirement — while giving admins, managers, sales reps, and retention agents each their own view of what matters to them.

It's a REST API: role-aware, transaction-safe on every multi-step write, and built to handle both one-off lead updates and bulk operations across thousands of records at once.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Roles & Access Control](#roles--access-control)
- [License](#license)

---

## Features

### 🔐 Authentication & Access Control

- JWT-based login/session handling — stateless, no server-side session store to manage.
- Self-service registration and login, with passwords hashed via bcrypt before they ever touch the database.
- A four-tier role system (**Admin**, **Manager**, **Sales Rep**, **Retention Agent**), enforced on every route via role-based middleware — not just hidden in the frontend.
- An office-network gate: non-admin roles can be restricted to authenticate only from an approved office IP, so field access to the CRM can be locked down without a VPN.
- Authenticated profile lookup and self-service password changes.

### 🧾 Lead Management

- Full CRUD on leads — name, company, contact details, country, source, campaign, and status, all in one record.
- Every status change and reassignment is logged as an assignment event, so a lead's ownership history is never lost, not just overwritten.
- Threaded notes on each lead, so a rep's call history and context travels with the lead across reassignments.
- Smart status-transition handling — converting a lead, marking it unreachable, or handing it off all follow business rules under the hood instead of trusting the client to get it right.

### 📦 Bulk Operations

Built for the reality that sales ops doesn't work one record at a time:

- **Bulk assign / reassign** — move a batch of leads to a new rep or team in one call, with the same ownership rules the single-lead flow enforces.
- **Bulk delete** — clean up in batches instead of one-by-one.
- **Bulk status, source, and campaign updates** — re-tag hundreds of leads after a campaign correction or a source rename without touching them individually.
- All bulk writes run inside database transactions and are chunked internally, so a batch of thousands doesn't choke the database or leave data half-updated if something fails partway through.

### 📥 CSV Import

- Upload a CSV of leads and have it mapped straight into the system.
- Unknown lead sources and campaigns encountered in the file are **created automatically** — no need to pre-configure every campaign name before an import.
- Built-in de-duplication against existing leads by email and phone number.
- Per-row validation feedback, so a bad row in a 5,000-row file doesn't silently corrupt data or fail the whole import.
- A template/schema endpoint the frontend can query to build the upload mapping UI dynamically.

### 📤 CSV Export

- Export the current filtered lead view straight to CSV.
- Streamed and server-side paginated, so exporting the entire database doesn't load it all into memory at once.
- Output includes a BOM and proper field escaping, so exported files open cleanly in Excel — no mangled special characters.

### ♻️ Automated Lead Retirement

LeadHive's answer to pipeline rot: leads that go cold don't just sit there forever cluttering a rep's queue.

- A configurable inactivity window (measured from the last note or reassignment) determines when a lead is considered stale.
- Stale leads are automatically reassigned to a designated admin/manager and moved into a retirement status — **without losing the context of where they were**. A lead that was in "Call Back" becomes "Retired Call Back," one that was "Not Interested" becomes "Retired Not Interested," and so on. Nothing gets flattened into a single generic bucket.
- Runs on a configurable cron schedule, or can be triggered on demand via a preview (dry-run) and run endpoint — so admins can see exactly what *would* be retired before committing to it.
- Every retirement run generates an in-app notification for the receiving admin, summarizing what was reclaimed and why.
- Leads that are Registered, Converted, or already retired are never touched — the job only ever reclaims genuinely inactive, unconverted pipeline.

### 📊 Role-Scoped Dashboards

Every role gets a dashboard built for the decisions they actually make:

- **Admins** see organization-wide KPIs — total pipeline, unassigned leads, new leads this week, retirement totals, and full status/source/campaign breakdowns.
- **Managers** see their team's pipeline, scoped automatically to the reps and retention agents they manage.
- **Sales Reps & Retention Agents** see their own assigned leads and personal performance at a glance.
- All breakdowns are zero-filled against the full set of statuses/sources/campaigns, so a dashboard chart never silently drops a category just because it happens to have zero leads today.

### 📈 Reporting

- Call statistics and volume trends over daily, monthly, or custom date ranges.
- Performance breakdowns by lead source and by campaign, to see what's actually driving conversions.
- Sales-from-calls conversion tracking, connecting activity to outcomes.
- Individual agent performance reports, scoped so managers only see their own team and reps only see themselves.

### 🔔 Notifications

- In-app notifications for events that matter to a user — like the retirement job handing them a batch of reclaimed leads.
- Simple list and mark-as-read endpoints, scoped strictly to the requesting user.

### ⚙️ Reference Data Administration

- Full CRUD over the lookup tables that drive the rest of the system: **lead statuses**, **lead sources**, and **campaigns**.
- Referential-integrity protection — a status, source, or campaign that's still in use by an existing lead can't be deleted out from under it; the API tells you exactly how many leads are affected instead of failing silently or corrupting data.

### 👥 Team & User Management

- Admins can create and manage users, assign roles, and deactivate accounts.
- Teams can be created with designated managers and members, and managers get a scoped view of their own team without needing separate admin access.
- Supporting lookup endpoints (available managers, assignable reps, unassigned users) keep the frontend's assignment pickers accurate in real time.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js |
| Framework | Express 5 |
| Database | MySQL, via Sequelize 6 ORM |
| Auth | JSON Web Tokens (`jsonwebtoken`) + `bcrypt` password hashing |
| Scheduling | `node-cron` (drives the lead retirement job) |
| File handling | `multer` (CSV/file uploads) |
| Validation | `zod` |
| Logging (dev) | `morgan` |

---

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# then fill in the values described below

# 3. Run it
npm run dev     # nodemon, auto-reloads on change
npm start        # production
```

The API listens on `NODE_LEADHIVE_PORT` (defaults to `8080`) and expects a MySQL database matching the schema defined under `models/`.

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `NODE_LEADHIVE_PORT` | no | Server port. Defaults to `8080`. |
| `NODE_LEADHIVE_MODE` | yes | Environment label (e.g. `development`, `production`), surfaced in startup logs. |
| `NODE_LEADHIVE_MYSQL_HOST` | yes | MySQL host. |
| `NODE_LEADHIVE_MYSQL_DATABASE` | yes | MySQL database name. |
| `NODE_LEADHIVE_MYSQL_USER` | yes | MySQL user. |
| `NODE_LEADHIVE_MYSQL_PASSWORD` | yes | MySQL password. |
| `NODE_LEADHIVE_JWT_SECRET` | yes | Signs and verifies auth tokens. |
| `NODE_LEADHIVE_BCRYPT_SALT_ROUNDS` | no | Bcrypt cost factor. Defaults to `10`. |
| `NODE_LEADHIVE_FRONTEND_URL` | yes | Allowed CORS origin for the frontend app. |
| `NODE_LEADHIVE_OFFICE_STATIC_IP` | no | If set, non-admin logins are restricted to this IP. |
| `NODE_LEADHIVE_RETIREMENT_ENABLED` | no | Set to `true` to start the retirement cron job. |
| `NODE_LEADHIVE_RETIREMENT_CRON` | no | Cron expression for retirement runs. Defaults to `0 8 * * *` (daily, 8am). |
| `NODE_LEADHIVE_RETIREMENT_DAYS` | no | Inactivity window, in days, before a lead is eligible for retirement. Defaults to `14`. |
| `NODE_LEADHIVE_RETIREMENT_REASSIGN_EMAIL` | required if retirement is enabled | The admin/manager account retired leads get reassigned to. |

---

## Project Structure

```
controllers/    Request handlers — one file per feature area
routes/         Express routers, mounted under /api/v1 in index.js
models/         Sequelize models, with associations centralized in models/index.js
middlewares/    JWT auth and role-based access control
jobs/           Lead retirement business logic (preview + run)
schedulers/     Cron wiring for background jobs
config/         Database connection and file-upload configuration
utils/          Shared response helpers
```

---

## API Reference

All endpoints are mounted under `/api/v1` and require a `Bearer` JWT unless marked public.

| Prefix | Covers |
|---|---|
| `/auth` | Register *(public)*, login *(public)*, profile, password change |
| `/users` | Admin user management |
| `/teams` | Team CRUD and membership |
| `/leads` | Lead CRUD, assignment, notes |
| `/leads/upload` | CSV/bulk lead import |
| `/leads/export` | Filtered CSV export |
| `/leads/retirement` | Preview/run automated retirement *(admin/manager)* |
| `/bulk` | Bulk assign, reassign, delete, and field updates |
| `/lead` | Lead status/source/campaign reference-data CRUD |
| `/dashboard` | Role-scoped summary dashboards |
| `/reports` | Call, sales, and agent performance reporting |
| `/notifications` | List notifications, mark as read |
| `/supports` | Lookup/dropdown data for the frontend |

---

## Roles & Access Control

| Role | Scope |
|---|---|
| **Admin** | Full access — all leads, all teams, all users, all reporting, reference-data administration. |
| **Manager** | Their own team's leads, reps, and reporting. |
| **Sales Rep** | Their own assigned leads and personal performance. |
| **Retention Agent** | Their own assigned (typically retired/reclaimed) leads. |

---

## License

*No license has been set for this project yet.*
