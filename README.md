# FitnessVitness CRM

Full-stack CRM web application: **Next.js** frontend, **Express** API, **MySQL**, **Clerk** authentication, subscriptions/orders, leads, tasks, reminders, meetings, notes, invoices, and an **admin** control panel.

---

## Tech stack

| Layer | Technology |
|--------|------------|
| Frontend | [Next.js 15](https://nextjs.org/), React 19, CSS modules, `next-themes` (light/dark) |
| Auth | [Clerk](https://clerk.com/) (`@clerk/nextjs`, `@clerk/express`) |
| Backend | Node.js, Express 4, MySQL2 |
| Payments / billing | Stripe (where integrated) |
| Brand UI | Yellow accent tokens (`--yellow`, CRM modal variables), responsive layouts |

---

## Repository layout

```
rnd-crm/
├── frontend/          # Next.js app (App Router)
│   ├── public/assets/ # Static assets (logos, illustrations)
│   └── src/
│       ├── app/       # Routes: marketing, (dashboard), admin, login, etc.
│       └── components/
├── backend/           # Express API
│   └── src/
│       ├── routes/    # REST routes (/api/..., /api/v2/...)
│       ├── controllers/
│       └── config/    # DB, schema helpers
└── README.md
```

---

## Prerequisites

- **Node.js** 20.x (see `frontend/package.json` `engines`)
- **MySQL** 8.x (or compatible)
- **Clerk** application (publishable key + secret key; JWT template for backend if required)

---

## Quick start (local)

### 1. Clone and install

```bash
git clone <your-repo-url>
cd rnd-crm

# Frontend
cd frontend
npm install

# Backend
cd ../backend
npm install
```

### 2. Database

Create a MySQL database and run migrations/setup as defined in your environment (e.g. `backend` scripts):

```bash
cd backend
npm run db:setup    # if applicable — creates/updates schema
# npm run db:seed   # optional sample data
```

### 3. Environment variables

Use the provided templates:

- `backend/.env.example` → copy to `backend/.env`
- `frontend/.env.example` → copy to `frontend/.env.local`

For production (Vercel + Render), set these carefully:

- Backend (Render):
  - Required runtime: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `JWT_REFRESH_SECRET`
  - Origins: `FRONTEND_URL`, `APP_URL`, `ALLOWED_ORIGINS`, `APP_BASE_DOMAIN`
  - Invite links: `INVITE_APP_URL` (must be your frontend URL)
  - Email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (plus optional `SMTP_TIMEOUT_MS=60000`, `SMTP_FORCE_IPV4=1`)
- Frontend (Vercel):
  - `NEXT_PUBLIC_API_URL` = your Render backend URL (no trailing `/api`)
  - `NEXT_PUBLIC_APP_BASE_DOMAIN` = your frontend base domain
  - Keep proxy behavior enabled (`NEXT_PUBLIC_API_PROD_PROXY=true`) so auth cookies are set on frontend origin.

> **Security:** Never commit real secrets. Keep actual values only in Vercel/Render dashboards.

### 4. Run dev servers

**Terminal A — API**

```bash
cd backend
npm run dev
```

**Terminal B — Next.js**

```bash
cd frontend
npm run dev
```

- App: [http://localhost:3000](http://localhost:3000)  
- API: [http://localhost:5000](http://localhost:5000) (default) — health check often at `/api/health`

---

## NPM scripts

### Frontend (`frontend/`)

| Script | Description |
|--------|-------------|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | ESLint |

### Backend (`backend/`)

| Script | Description |
|--------|-------------|
| `npm run dev` | Nodemon (dev) |
| `npm start` | Production server |
| `npm run db:setup` | Database setup script |
| `npm run db:seed` | Seed data (if configured) |

---

## Features (high level)

- **Marketing site** — landing, features, pricing, blog, integrations, calculators  
- **Dashboard** — KPIs, charts, quick-create modals (leads, tasks, reminders, meetings, notes, quick invoice)  
- **Leads** — filters, date range, add lead (attachments), lead detail  
- **Workspace** — tasks, reminders, meetings, notes (API-backed)  
- **Subscription gate** — dashboard routes require an active/trial order unless on allowed paths (e.g. add-package)  
- **Admin** (`/admin`) — role `admin` only: users, orders/subscriptions, contacts, stats  
- **Error handling** — global `not-found`, `/forbidden`, shared `AppErrorPage` with smart “home” navigation  
- **Theming** — light/dark via CSS variables and theme toggle  

---

## Admin panel — who sees it, when, and security

### Who should see “Admin” in the CRM UI?

| Role (`users.role` in MySQL) | Admin button / sidebar link | Can use admin APIs? |
|------------------------------|------------------------------|----------------------|
| **`admin`** | Yes (after `/api/users/me` loads) | Yes |
| **`manager`**, **`staff`** | No | No (`403` from `/api/admin/*`) |
| **Inactive** user (`is_active = 0`) | No (typically cannot load app normally) | No |

**Best practice:** Show admin navigation **only** when the backend says `role === "admin"` (this project uses `GET /api/users/me`). That keeps the UI honest and matches what the server will allow.

**When** it appears: after sign-in and subscription gate, once `UserRoleProvider` has finished loading the user row from the API. Non-admins never see those controls.

### Backend enforcement (required)

Hiding buttons in the browser is **not** security. Every admin action must be enforced on the server.

In this codebase, **all** routes under **`/api/admin/`** use:

1. **Clerk** `requireAuth()` — valid session  
2. **`clerkVerify`** — loads the user from MySQL, sets `req.user.role`  
3. **`requireAdmin`** — returns `403` unless `req.user.role === "admin"`

So even if someone crafts a request or changes the frontend, **only database `admin` users** can list users, change roles, grant trials, update orders, etc. New admin features should follow the same pattern: **authenticate → load DB user → check role (or permission) → then read/write data.**

---

## Deployment notes

- **Frontend:** Vercel or any Node host; set `NEXT_PUBLIC_*` and server env for Clerk.  
- **Backend:** Host with Node; set `PORT`, DB, Clerk, `FRONTEND_URL`, and CORS `ALLOWED_ORIGINS` as needed.  
- **Database:** Run migrations/setup on the server; use managed MySQL in production.  

---

## Contributing

1. Fork the repository  
2. Create a feature branch (`git checkout -b feature/your-change`)  
3. Commit with clear messages  
4. Open a Pull Request  

---

## License

Specify your license here (e.g. MIT, proprietary). If undecided, omit or use “All rights reserved.”

---

## Support

For issues and feature requests, use **GitHub Issues** on this repository.

---

<p align="center">
  <b>FitnessVitness CRM</b> · Built with Next.js & Express
</p>
