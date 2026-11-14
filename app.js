require("dotenv").config();

const path = require("node:path");
const express = require("express");
const expressLayouts = require("express-ejs-layouts");
const session = require("express-session");
const helmet = require("helmet");

const { initDb } = require("./db");
const queries = require("./queries");
const validation = require("./validation");

const euro = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
});

function formatMoney(cents) {
  return euro.format((Number(cents) || 0) / 100);
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function buildQuery(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== "" && value != null) search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : "";
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function createApp(db) {
  const app = express();

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.set("trust proxy", 1);
  app.use(expressLayouts);
  app.set("layout", "layout");

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.static(path.join(__dirname, "public")));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(session({
    secret: process.env.SESSION_SECRET || "local-development-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 8,
    },
  }));

  app.use((req, res, next) => {
    res.locals.active = "";
    res.locals.pageTitle = "Finance Tracker";
    res.locals.pageSubtitle = "";
    res.locals.pageScript = null;
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;
    res.locals.money = formatMoney;
    res.locals.formatDate = validation.formatDateLabel;
    res.locals.formatMonth = validation.formatMonthLabel;
    res.locals.today = validation.todayISO();
    res.locals.buildQuery = buildQuery;
    next();
  });

  // Dashboard
  app.get("/", (req, res) => {
    const month = validation.isValidMonth(req.query.month)
      ? req.query.month
      : validation.currentMonthKey();
    const data = queries.getDashboardData(db, month);

    res.render("dashboard", {
      title: "Dashboard",
      subtitle: `Overview for ${validation.formatMonthLabel(month)}`,
      active: "dashboard",
      month,
      months: validation.monthOptions(12),
      data,
      dashboardJson: safeJson(data),
      pageScript: "dashboard.js",
    });
  });

  app.get("/api/dashboard", (req, res) => {
    const month = validation.isValidMonth(req.query.month)
      ? req.query.month
      : validation.currentMonthKey();
    res.json(queries.getDashboardData(db, month));
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // Transactions
  app.get("/transactions", (req, res) => {
    const perPage = 12;
    const filters = {
      month: validation.isValidMonth(req.query.month) ? req.query.month : "",
      type: req.query.type === "income" || req.query.type === "expense" ? req.query.type : "",
      accountId: validation.parseId(req.query.account),
      categoryId: validation.parseId(req.query.category),
      search: String(req.query.search || "").trim().slice(0, 80),
      page: Math.max(1, validation.parseId(req.query.page) || 1),
    };

    let result = queries.getTransactions(db, filters, perPage);
    let pages = Math.max(1, Math.ceil(result.total / perPage));
    if (filters.page > pages) {
      filters.page = pages;
      result = queries.getTransactions(db, filters, perPage);
    }

    res.render("transactions", {
      title: "Transactions",
      subtitle: `${result.total} transaction${result.total === 1 ? "" : "s"} found`,
      active: "transactions",
      filters,
      accounts: queries.getAccounts(db),
      categories: queries.getCategories(db),
      months: validation.monthOptions(12),
      transactions: result.rows,
      total: result.total,
      page: filters.page,
      pages,
      perPage,
    });
  });

  app.get("/transactions/new", (req, res) => {
    const values = {
      type: "expense",
      transactionDate: validation.todayISO(),
      description: "",
      amount: "",
      accountId: "",
      categoryId: "",
    };

    res.render("transaction-form", {
      title: "Add transaction",
      subtitle: "Record income or an expense",
      active: "transactions",
      mode: "create",
      action: "/transactions",
      values,
      errors: {},
      accounts: queries.getAccounts(db),
      categories: queries.getCategories(db),
    });
  });

  app.post("/transactions", (req, res) => {
    const accounts = queries.getAccounts(db);
    const categories = queries.getCategories(db);
    const checked = validation.validateTransaction(req.body, accounts, categories);

    if (Object.keys(checked.errors).length) {
      return res.status(422).render("transaction-form", {
        title: "Add transaction",
        subtitle: "Fix the errors below",
        active: "transactions",
        mode: "create",
        action: "/transactions",
        values: checked.values,
        errors: checked.errors,
        accounts,
        categories,
      });
    }

    queries.insertTransaction(db, {
      accountId: checked.values.accountId,
      categoryId: checked.values.categoryId,
      type: checked.values.type,
      amountCents: checked.amountCents,
      description: checked.values.description,
      transactionDate: checked.values.transactionDate,
    });

    setFlash(req, "success", "Transaction added.");
    res.redirect("/transactions");
  });

  app.get("/transactions/:id/edit", (req, res, next) => {
    const transaction = queries.getTransaction(db, validation.parseId(req.params.id));
    if (!transaction) return next();

    res.render("transaction-form", {
      title: "Edit transaction",
      subtitle: "Update the details and save",
      active: "transactions",
      mode: "edit",
      action: `/transactions/${transaction.id}`,
      values: {
        type: transaction.type,
        transactionDate: transaction.transaction_date,
        description: transaction.description,
        amount: (transaction.amount_cents / 100).toFixed(2),
        accountId: transaction.account_id,
        categoryId: transaction.category_id,
      },
      errors: {},
      accounts: queries.getAccounts(db),
      categories: queries.getCategories(db),
    });
  });

  app.post("/transactions/:id", (req, res, next) => {
    const id = validation.parseId(req.params.id);
    const existing = queries.getTransaction(db, id);
    if (!existing) return next();

    const accounts = queries.getAccounts(db);
    const categories = queries.getCategories(db);
    const checked = validation.validateTransaction(req.body, accounts, categories);

    if (Object.keys(checked.errors).length) {
      return res.status(422).render("transaction-form", {
        title: "Edit transaction",
        subtitle: "Fix the errors below",
        active: "transactions",
        mode: "edit",
        action: `/transactions/${id}`,
        values: checked.values,
        errors: checked.errors,
        accounts,
        categories,
      });
    }

    queries.updateTransaction(db, id, {
      accountId: checked.values.accountId,
      categoryId: checked.values.categoryId,
      type: checked.values.type,
      amountCents: checked.amountCents,
      description: checked.values.description,
      transactionDate: checked.values.transactionDate,
    });

    setFlash(req, "success", "Transaction updated.");
    res.redirect("/transactions");
  });

  app.post("/transactions/:id/delete", (req, res) => {
    queries.deleteTransaction(db, validation.parseId(req.params.id));
    setFlash(req, "success", "Transaction deleted.");
    res.redirect("/transactions");
  });

  // Accounts
  app.get("/accounts", (req, res) => {
    res.render("accounts", {
      title: "Accounts",
      subtitle: "Where your money sits",
      active: "accounts",
      accounts: queries.getAccountsWithBalances(db),
      values: { name: "", type: "current", openingBalance: "0.00", colour: "#2563eb" },
      errors: {},
    });
  });

  app.post("/accounts", (req, res) => {
    const existing = queries.getAccounts(db);
    const checked = validation.validateAccount(req.body, existing);

    if (Object.keys(checked.errors).length) {
      return res.status(422).render("accounts", {
        title: "Accounts",
        subtitle: "Fix the errors below",
        active: "accounts",
        accounts: queries.getAccountsWithBalances(db),
        values: checked.values,
        errors: checked.errors,
      });
    }

    queries.insertAccount(db, {
      name: checked.values.name,
      type: checked.values.type,
      openingBalanceCents: checked.openingBalanceCents,
      colour: checked.values.colour,
    });

    setFlash(req, "success", "Account added.");
    res.redirect("/accounts");
  });

  app.get("/accounts/:id/edit", (req, res, next) => {
    const account = queries.getAccount(db, validation.parseId(req.params.id));
    if (!account) return next();

    res.render("account-form", {
      title: "Edit account",
      subtitle: "Update the account details",
      active: "accounts",
      action: `/accounts/${account.id}`,
      values: {
        name: account.name,
        type: account.type,
        openingBalance: (account.opening_balance_cents / 100).toFixed(2),
        colour: account.colour,
      },
      errors: {},
    });
  });

  app.post("/accounts/:id", (req, res, next) => {
    const id = validation.parseId(req.params.id);
    const existing = queries.getAccount(db, id);
    if (!existing) return next();

    const checked = validation.validateAccount(req.body, queries.getAccounts(db), id);

    if (Object.keys(checked.errors).length) {
      return res.status(422).render("account-form", {
        title: "Edit account",
        subtitle: "Fix the errors below",
        active: "accounts",
        action: `/accounts/${id}`,
        values: checked.values,
        errors: checked.errors,
      });
    }

    queries.updateAccount(db, id, {
      name: checked.values.name,
      type: checked.values.type,
      openingBalanceCents: checked.openingBalanceCents,
      colour: checked.values.colour,
    });

    setFlash(req, "success", "Account updated.");
    res.redirect("/accounts");
  });

  app.post("/accounts/:id/delete", (req, res) => {
    try {
      queries.deleteAccount(db, validation.parseId(req.params.id));
      setFlash(req, "success", "Account deleted.");
    } catch (error) {
      setFlash(req, "error", "That account still has transactions. Move or delete them first.");
    }
    res.redirect("/accounts");
  });

  // Categories
  app.get("/categories", (req, res) => {
    res.render("categories", {
      title: "Categories",
      subtitle: "How transactions are grouped",
      active: "categories",
      categories: queries.getCategories(db),
      values: { name: "", kind: "expense", colour: "#64748b" },
      errors: {},
    });
  });

  app.post("/categories", (req, res) => {
    const existing = queries.getCategories(db);
    const checked = validation.validateCategory(req.body, existing);

    if (Object.keys(checked.errors).length) {
      return res.status(422).render("categories", {
        title: "Categories",
        subtitle: "Fix the errors below",
        active: "categories",
        categories: existing,
        values: checked.values,
        errors: checked.errors,
      });
    }

    queries.insertCategory(db, {
      name: checked.values.name,
      kind: checked.values.kind,
      colour: checked.values.colour,
    });

    setFlash(req, "success", "Category added.");
    res.redirect("/categories");
  });

  app.get("/categories/:id/edit", (req, res, next) => {
    const category = queries.getCategory(db, validation.parseId(req.params.id));
    if (!category) return next();

    res.render("category-form", {
      title: "Edit category",
      subtitle: "Update the category details",
      active: "categories",
      action: `/categories/${category.id}`,
      values: {
        name: category.name,
        kind: category.kind,
        colour: category.colour,
      },
      errors: {},
    });
  });

  app.post("/categories/:id", (req, res, next) => {
    const id = validation.parseId(req.params.id);
    const existing = queries.getCategory(db, id);
    if (!existing) return next();

    const allCategories = queries.getCategories(db);
    const checked = validation.validateCategory(req.body, allCategories, id);
    const usage = allCategories.find((category) => Number(category.id) === id);
    if (usage && Number(usage.transaction_count) > 0 && checked.values.kind !== existing.kind) {
      checked.errors.kind = "You cannot change the type of a category that already has transactions.";
    }

    if (Object.keys(checked.errors).length) {
      return res.status(422).render("category-form", {
        title: "Edit category",
        subtitle: "Fix the errors below",
        active: "categories",
        action: `/categories/${id}`,
        values: checked.values,
        errors: checked.errors,
      });
    }

    queries.updateCategory(db, id, {
      name: checked.values.name,
      kind: checked.values.kind,
      colour: checked.values.colour,
    });

    setFlash(req, "success", "Category updated.");
    res.redirect("/categories");
  });

  app.post("/categories/:id/delete", (req, res) => {
    try {
      queries.deleteCategory(db, validation.parseId(req.params.id));
      setFlash(req, "success", "Category deleted.");
    } catch (error) {
      setFlash(req, "error", "That category is used by transactions or budgets. Remove those links first.");
    }
    res.redirect("/categories");
  });

  // Budgets
  app.get("/budgets", (req, res) => {
    const month = validation.isValidMonth(req.query.month)
      ? req.query.month
      : validation.currentMonthKey();
    const status = queries.getBudgetStatus(db, month);
    const totals = status.reduce((sum, item) => ({
      budgetCents: sum.budgetCents + item.budgetCents,
      spentCents: sum.spentCents + item.spentCents,
    }), { budgetCents: 0, spentCents: 0 });
    totals.remainingCents = totals.budgetCents - totals.spentCents;

    res.render("budgets", {
      title: "Budgets",
      subtitle: `Monthly plan for ${validation.formatMonthLabel(month)}`,
      active: "budgets",
      month,
      months: validation.monthOptions(12),
      status,
      totals,
      values: {},
      errors: {},
      budgetJson: safeJson({ month, status, totals }),
      pageScript: "budgets.js",
    });
  });

  app.post("/budgets", (req, res) => {
    const month = validation.isValidMonth(req.body.month)
      ? req.body.month
      : validation.currentMonthKey();
    const expenseCategories = queries.getCategories(db, "expense");
    const values = {};
    const errors = {};

    expenseCategories.forEach((category) => {
      const raw = String(req.body[`budget_${category.id}`] || "").trim();
      values[category.id] = raw;
      if (raw === "") return;
      const parsed = validation.parseMoneyToCents(raw);
      if (parsed.error) errors[category.id] = parsed.error;
    });

    if (Object.keys(errors).length) {
      const status = queries.getBudgetStatus(db, month);
      const totals = status.reduce((sum, item) => ({
        budgetCents: sum.budgetCents + item.budgetCents,
        spentCents: sum.spentCents + item.spentCents,
      }), { budgetCents: 0, spentCents: 0 });
      totals.remainingCents = totals.budgetCents - totals.spentCents;

      return res.status(422).render("budgets", {
        title: "Budgets",
        subtitle: "Fix the amounts below",
        active: "budgets",
        month,
        months: validation.monthOptions(12),
        status,
        totals,
        values,
        errors,
        budgetJson: safeJson({ month, status, totals }),
        pageScript: "budgets.js",
      });
    }

    db.exec("BEGIN");
    try {
      expenseCategories.forEach((category) => {
        const raw = values[category.id];
        if (raw === "") {
          queries.deleteBudget(db, category.id, month);
        } else {
          const parsed = validation.parseMoneyToCents(raw);
          queries.upsertBudget(db, category.id, month, parsed.cents);
        }
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    setFlash(req, "success", `Budgets saved for ${validation.formatMonthLabel(month)}.`);
    res.redirect(`/budgets?month=${month}`);
  });

  // About
  app.get("/about", (req, res) => {
    res.render("about", {
      title: "About this project",
      subtitle: "How the finance tracker is built",
      active: "about",
    });
  });

  // 404 and error pages
  app.use((req, res) => {
    res.status(404).render("error", {
      title: "Page not found",
      subtitle: "",
      active: "",
      status: 404,
      message: "The page you asked for does not exist.",
    });
  });

  app.use((error, req, res, next) => {
    void next;
    console.error(error);
    const status = error.status || 500;
    res.status(status).render("error", {
      title: "Something went wrong",
      subtitle: "",
      active: "",
      status,
      message: process.env.NODE_ENV === "production"
        ? "An unexpected error occurred. Please try again."
        : error.message,
    });
  });

  return app;
}

if (require.main === module) {
  const filename = process.env.DATABASE_PATH || path.join(__dirname, "data", "finance.db");
  const db = initDb(filename);
  const app = createApp(db);
  const port = Number(process.env.PORT) || 3000;

  app.listen(port, () => {
    console.log(`Finance Tracker running at http://localhost:${port}`);
    console.log(`Database: ${filename}`);
  });
}

module.exports = { createApp, formatMoney };
