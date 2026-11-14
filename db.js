const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('current', 'savings', 'credit', 'cash')),
    opening_balance_cents INTEGER NOT NULL DEFAULT 0
      CHECK (opening_balance_cents BETWEEN -100000000 AND 100000000),
    colour TEXT NOT NULL DEFAULT '#2563eb'
      CHECK (colour GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
    colour TEXT NOT NULL DEFAULT '#64748b'
      CHECK (colour GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000),
    description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 2 AND 120),
    transaction_date TEXT NOT NULL
      CHECK (transaction_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (category_id, month)
  );

  CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date DESC);
  CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
  CREATE INDEX IF NOT EXISTS idx_budgets_month ON budgets(month);

  CREATE TRIGGER IF NOT EXISTS trg_transactions_kind_insert
  BEFORE INSERT ON transactions
  FOR EACH ROW
  WHEN (SELECT kind FROM categories WHERE id = NEW.category_id) <> NEW.type
  BEGIN
    SELECT RAISE(ABORT, 'transaction type does not match category kind');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_transactions_kind_update
  BEFORE UPDATE OF category_id, type ON transactions
  FOR EACH ROW
  WHEN (SELECT kind FROM categories WHERE id = NEW.category_id) <> NEW.type
  BEGIN
    SELECT RAISE(ABORT, 'transaction type does not match category kind');
  END;
`;

function openDatabase(filename) {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON;");
  if (filename !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }
  return db;
}

function localDateISO(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function currentMonthKey(date) {
  return localDateISO(date).slice(0, 7);
}

function monthKeyOffset(date, offset) {
  const copy = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  return currentMonthKey(copy);
}

function lastDayOfMonth(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

function mulberry32(seed) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function seed(db) {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM accounts").get();
  if (Number(existing.count) > 0) return false;

  const today = new Date();
  const todayISO = localDateISO(today);
  const todayDay = today.getDate();
  const thisMonth = currentMonthKey(today);
  const months = [];
  for (let offset = -6; offset <= 0; offset += 1) {
    months.push(monthKeyOffset(today, offset));
  }

  const random = mulberry32(20261114);
  const randInt = (min, max) => Math.floor(random() * (max - min + 1)) + min;
  const pick = (items) => items[Math.floor(random() * items.length)];
  const cents = (euros) => Math.round(euros * 100);

  const insertAccount = db.prepare(
    "INSERT INTO accounts (name, type, opening_balance_cents, colour) VALUES (?, ?, ?, ?)"
  );
  const insertCategory = db.prepare(
    "INSERT INTO categories (name, kind, colour) VALUES (?, ?, ?)"
  );
  const insertTransaction = db.prepare(`
    INSERT INTO transactions
      (account_id, category_id, type, amount_cents, description, transaction_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertBudget = db.prepare(
    "INSERT INTO budgets (category_id, month, amount_cents) VALUES (?, ?, ?)"
  );

  db.exec("BEGIN");
  try {
    const accounts = {};
    [
      ["Everyday Current", "current", 250000, "#2563eb"],
      ["Rainy Day Savings", "savings", 800000, "#059669"],
      ["Credit Card", "credit", -35000, "#dc2626"],
      ["Cash Wallet", "cash", 12000, "#d97706"],
    ].forEach(([name, type, opening, colour]) => {
      const result = insertAccount.run(name, type, opening, colour);
      accounts[name] = Number(result.lastInsertRowid);
    });

    const categories = {};
    [
      ["Salary", "income", "#059669"],
      ["Freelance", "income", "#0891b2"],
      ["Interest", "income", "#7c3aed"],
      ["Rent", "expense", "#dc2626"],
      ["Groceries", "expense", "#16a34a"],
      ["Utilities", "expense", "#0ea5e9"],
      ["Transport", "expense", "#f59e0b"],
      ["Eating Out", "expense", "#f97316"],
      ["Entertainment", "expense", "#8b5cf6"],
      ["Shopping", "expense", "#ec4899"],
      ["Subscriptions", "expense", "#64748b"],
      ["Health", "expense", "#14b8a6"],
      ["Education", "expense", "#6366f1"],
    ].forEach(([name, kind, colour]) => {
      const result = insertCategory.run(name, kind, colour);
      categories[name] = Number(result.lastInsertRowid);
    });

    const add = (account, category, type, amountEuros, description, date) => {
      if (!date || date > todayISO) return;
      insertTransaction.run(
        accounts[account],
        categories[category],
        type,
        cents(amountEuros),
        description,
        date
      );
    };

    const dateFor = (monthKey, day) => {
      const lastDay = lastDayOfMonth(monthKey);
      const maxDay = monthKey === thisMonth ? todayDay : lastDay;
      const safeDay = Math.min(day, maxDay);
      if (safeDay < 1) return null;
      return `${monthKey}-${String(safeDay).padStart(2, "0")}`;
    };

    months.forEach((monthKey, index) => {
      const monthNumber = Number(monthKey.slice(5, 7));

      add("Everyday Current", "Salary", "income", 3200, "Monthly salary", dateFor(monthKey, 1));
      if (index % 2 === 1 || monthNumber % 3 === 0) {
        add(
          "Everyday Current",
          "Freelance",
          "income",
          randInt(35000, 65000) / 100,
          pick(["Website update", "Freelance design work", "Consulting session"]),
          dateFor(monthKey, randInt(8, 18))
        );
      }
      if (monthNumber % 3 === 0) {
        add("Rainy Day Savings", "Interest", "income", randInt(800, 1500) / 100, "Savings interest", dateFor(monthKey, 28));
      }

      add("Everyday Current", "Rent", "expense", 1200, "Apartment rent", dateFor(monthKey, 1));
      add("Everyday Current", "Utilities", "expense", randInt(8500, 14000) / 100, pick(["Electricity and gas", "Energy bill", "Utilities bill"]), dateFor(monthKey, randInt(4, 9)));
      add("Everyday Current", "Health", "expense", randInt(2000, 6000) / 100, pick(["Pharmacy", "GP visit", "Prescription"]), dateFor(monthKey, randInt(10, 20)));

      const groceryRuns = randInt(3, 4);
      for (let i = 0; i < groceryRuns; i += 1) {
        add(
          pick(["Everyday Current", "Credit Card"]),
          "Groceries",
          "expense",
          randInt(4500, 11000) / 100,
          pick(["Weekly grocery shop", "Supermarket run", "Groceries"]),
          dateFor(monthKey, 3 + i * 6 + randInt(0, 3))
        );
      }

      const transportRuns = randInt(2, 3);
      for (let i = 0; i < transportRuns; i += 1) {
        add(
          pick(["Everyday Current", "Cash Wallet"]),
          "Transport",
          "expense",
          randInt(2500, 6000) / 100,
          pick(["Bus and Luas top up", "Fuel", "Taxi"]),
          dateFor(monthKey, 5 + i * 7 + randInt(0, 2))
        );
      }

      const meals = randInt(2, 3);
      for (let i = 0; i < meals; i += 1) {
        add(
          "Credit Card",
          "Eating Out",
          "expense",
          randInt(1800, 5500) / 100,
          pick(["Dinner with friends", "Lunch in town", "Coffee and lunch", "Takeaway"]),
          dateFor(monthKey, 6 + i * 6 + randInt(0, 3))
        );
      }

      add("Credit Card", "Entertainment", "expense", randInt(1200, 4500) / 100, pick(["Cinema", "Concert ticket", "Streaming rental"]), dateFor(monthKey, randInt(12, 24)));
      add("Credit Card", "Shopping", "expense", randInt(2500, 12000) / 100, pick(["Clothes", "Home supplies", "Online order"]), dateFor(monthKey, randInt(15, 26)));
      add("Credit Card", "Subscriptions", "expense", 12.99, "Music subscription", dateFor(monthKey, 7));
      add("Credit Card", "Subscriptions", "expense", 10.99, "Cloud storage", dateFor(monthKey, 14));
      if (monthNumber % 2 === 0) {
        add("Everyday Current", "Education", "expense", randInt(3000, 8000) / 100, pick(["Course materials", "Textbook", "Online course"]), dateFor(monthKey, randInt(16, 26)));
      }
    });

    const budgetPlan = {
      Rent: 1200,
      Groceries: 380,
      Utilities: 150,
      Transport: 120,
      "Eating Out": 220,
      Entertainment: 100,
      Shopping: 150,
      Subscriptions: 30,
      Health: 80,
      Education: 100,
    };

    months.slice(-3).forEach((monthKey) => {
      Object.entries(budgetPlan).forEach(([name, amount]) => {
        insertBudget.run(categories[name], monthKey, cents(amount));
      });
    });

    db.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?)").run("seeded_at", todayISO);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return true;
}

function initDb(filename) {
  const db = openDatabase(filename);
  db.exec(SCHEMA);
  seed(db);
  return db;
}

function resetDb(filename) {
  if (filename !== ":memory:" && fs.existsSync(filename)) {
    fs.rmSync(filename, { force: true });
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      fs.rmSync(`${filename}${suffix}`, { force: true });
    }
  }
  return initDb(filename);
}

module.exports = {
  initDb,
  resetDb,
  openDatabase,
  seed,
  localDateISO,
  currentMonthKey,
  monthKeyOffset,
  lastDayOfMonth,
};

if (require.main === module && process.argv.includes("--reset")) {
  require("dotenv").config();
  const filename = process.env.DATABASE_PATH || path.join(__dirname, "data", "finance.db");
  resetDb(filename);
  console.log(`Database reset and seeded: ${filename}`);
}
