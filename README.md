# Finance Tracker

A solo final project for **Web Application Development** at National College of Ireland.

Finance Tracker is a server-rendered personal finance application built with Node.js, Express, SQLite, EJS and Chart.js. It stores accounts, categories, transactions and monthly budgets in a relational database, validates every write at three levels, and visualises spending and budget performance in the browser.

- Module: Web Application Development (H6WAD)
- Due date: 12 December 2026

## Features

- Dashboard with total balance, monthly income, expenses, net savings and savings rate
- Doughnut chart of spending by category and a six-month income and expense bar chart
- Full CRUD for transactions, accounts and categories
- Filtering by month, type, account, category and description, with pagination
- Monthly budgets with a planned versus actual bar chart and over-budget highlighting
- Server-side validation for amounts, dates, descriptions, duplicate names and category/type matching
- SQLite constraints, foreign keys and triggers that enforce the same rules at the storage layer
- JSON endpoints for the dashboard and a Render health check
- 27 automated tests with `node:test` and Supertest

## Requirements

- Node.js 24 or newer (the project uses the built-in `node:sqlite` module)
- npm

## Local setup

```bash
cd "Final Project"
npm install
npm start
```

Open <http://localhost:3000>.

The database is created and seeded automatically on first start at `data/finance.db`. The seed data is deterministic: 4 accounts, 13 categories, 125 transactions across seven months and 30 budgets.

If the project is stored on a filesystem that does not support symbolic links (for example some exFAT drives), install with:

```bash
npm install --no-bin-links
```

### Environment variables

Copy `.env.example` to `.env` if you want to override the defaults.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `SESSION_SECRET` | local development value | Signs the session cookie |
| `DATABASE_PATH` | `./data/finance.db` | SQLite database file |
| `NODE_ENV` | unset | Set to `production` to hide internal error messages |

### Useful commands

```bash
npm start          # run the server
npm run dev        # run with file watching
npm test           # run the automated tests
npm run reset-db   # delete and reseed the database
```

## Project structure

```text
Final Project/
  app.js               Express application, routes, API endpoints and startup
  db.js                Schema, constraints, triggers, indexes and seed data
  queries.js           All SQL statements as named functions
  validation.js        Server-side validation and formatting helpers
  views/               EJS pages and partials
    layout.ejs         Shared shell, navigation, header and footer
    dashboard.ejs      Summary cards, charts, budgets and recent activity
    transactions.ejs   Filterable, paginated transaction list
    transaction-form.ejs
    accounts.ejs / account-form.ejs
    categories.ejs / category-form.ejs
    budgets.ejs        Monthly budget editor and comparison chart
    about.ejs / error.ejs
    nav-link.ejs / flash.ejs
  public/
    css/styles.css     Component styles, sidebar, tables, buttons and states
    js/app.js          Navigation, flash dismissal, confirmations, category filter
    js/dashboard.js    Doughnut and trend charts
    js/budgets.js      Planned versus actual chart
    favicon.svg
  tests/               node:test and Supertest suites
  docs/                Report source, PDF builder, PDF and video plan
  render.yaml          Render Blueprint
```

## Data model

Four tables:

- `accounts`: name, type, opening balance in cents, colour
- `categories`: name, kind (`income` or `expense`), colour
- `transactions`: account, category, type, amount in cents, description, date
- `budgets`: category, month, amount in cents, unique per category and month

Money is stored as integer cents. Names are unique regardless of case. Foreign keys are enabled, accounts and categories use `ON DELETE RESTRICT`, and budgets cascade. Two triggers reject a transaction whose type does not match the kind of its category.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Dashboard, optionally filtered by `?month=YYYY-MM` |
| GET | `/transactions` | List with filters and pagination |
| GET | `/transactions/new` | New transaction form |
| POST | `/transactions` | Create a transaction |
| GET | `/transactions/:id/edit` | Edit form |
| POST | `/transactions/:id` | Update a transaction |
| POST | `/transactions/:id/delete` | Delete a transaction |
| GET | `/accounts` | Accounts and balances |
| POST | `/accounts` | Create an account |
| GET | `/accounts/:id/edit` | Edit form |
| POST | `/accounts/:id` | Update an account |
| POST | `/accounts/:id/delete` | Delete an account |
| GET | `/categories` | Categories grouped by kind |
| POST | `/categories` | Create a category |
| GET | `/categories/:id/edit` | Edit form |
| POST | `/categories/:id` | Update a category |
| POST | `/categories/:id/delete` | Delete a category |
| GET | `/budgets` | Budget editor, optionally filtered by month |
| POST | `/budgets` | Upsert or remove every budget for a month |
| GET | `/about` | Project and technology notes |
| GET | `/api/dashboard` | Dashboard data as JSON |
| GET | `/api/health` | Health check used by Render |

## Testing

```bash
npm test
```

The suite covers the health endpoint, dashboard HTML and JSON, pagination and filters, valid and invalid transactions, category/type mismatches, editing and deletion, HTML escaping, duplicate accounts and categories, protected deletions, budget upserts, the custom 404 page, database triggers and the validation helpers.

## Deployment to Render

The repository includes `render.yaml`, so the quickest route is a Blueprint.

1. Push this project to a GitHub repository. If the app lives in a subfolder, set the Render **Root Directory** to `Final Project`.
2. In Render, choose **New > Blueprint** and connect the repository.
3. Apply the Blueprint. It creates a free Node web service with:
   - build command `npm install`
   - start command `npm start`
   - health check `/api/health`
   - generated `SESSION_SECRET`
   - `DATABASE_PATH=./data/finance.db`
   - `NODE_VERSION=24`
4. Wait for the deploy and open the public URL.

Manual alternative: create a **Web Service** with runtime Node, build `npm install`, start `npm start`, health check `/api/health`, and add the environment variables listed above.

### Important limitation

Render's free tier has an ephemeral filesystem. The SQLite file is recreated and reseeded whenever the service restarts, so changes made through the interface are not permanent. This is documented and acceptable for the demonstration. For persistent data, attach a Render disk or move to PostgreSQL.

The free instance also spins down after inactivity, so the first request after a quiet period can take up to a minute.

## Notes

- No authentication is included. This is a single-user demonstration and should not hold real financial data.
- Chart.js and Tailwind CSS are loaded from CDNs. Helmet's content security policy is disabled so the CDN assets can load.
- All user-supplied text is escaped by EJS. SQL uses prepared statements throughout.
