const { monthKeyOffset } = require("./db");

function getTotalBalanceCents(db) {
  const row = db.prepare(`
    SELECT
      (SELECT COALESCE(SUM(opening_balance_cents), 0) FROM accounts)
      + COALESCE(SUM(CASE WHEN type = 'income' THEN amount_cents ELSE -amount_cents END), 0)
      AS total
    FROM transactions
  `).get();
  return Number(row.total) || 0;
}

function getAccounts(db) {
  return db.prepare(`
    SELECT id, name, type, opening_balance_cents, colour
    FROM accounts
    ORDER BY name COLLATE NOCASE
  `).all();
}

function getAccountsWithBalances(db) {
  return db.prepare(`
    SELECT
      a.id,
      a.name,
      a.type,
      a.opening_balance_cents,
      a.colour,
      a.opening_balance_cents
        + COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount_cents ELSE -t.amount_cents END), 0)
        AS balance_cents,
      COUNT(t.id) AS transaction_count
    FROM accounts a
    LEFT JOIN transactions t ON t.account_id = a.id
    GROUP BY a.id
    ORDER BY a.name COLLATE NOCASE
  `).all();
}

function getAccount(db, id) {
  return db.prepare(`
    SELECT id, name, type, opening_balance_cents, colour
    FROM accounts
    WHERE id = ?
  `).get(id);
}

function getAccountByName(db, name, excludeId) {
  if (excludeId) {
    return db.prepare("SELECT id FROM accounts WHERE name = ? COLLATE NOCASE AND id <> ?").get(name, excludeId);
  }
  return db.prepare("SELECT id FROM accounts WHERE name = ? COLLATE NOCASE").get(name);
}

function insertAccount(db, account) {
  return db.prepare(`
    INSERT INTO accounts (name, type, opening_balance_cents, colour)
    VALUES (?, ?, ?, ?)
  `).run(account.name, account.type, account.openingBalanceCents, account.colour);
}

function updateAccount(db, id, account) {
  return db.prepare(`
    UPDATE accounts
    SET name = ?, type = ?, opening_balance_cents = ?, colour = ?
    WHERE id = ?
  `).run(account.name, account.type, account.openingBalanceCents, account.colour, id);
}

function deleteAccount(db, id) {
  return db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
}

function getCategories(db, kind) {
  const params = [];
  let where = "";
  if (kind) {
    where = "WHERE c.kind = ?";
    params.push(kind);
  }
  return db.prepare(`
    SELECT
      c.id,
      c.name,
      c.kind,
      c.colour,
      COUNT(t.id) AS transaction_count,
      COALESCE(SUM(t.amount_cents), 0) AS total_cents
    FROM categories c
    LEFT JOIN transactions t ON t.category_id = c.id
    ${where}
    GROUP BY c.id
    ORDER BY c.kind, c.name COLLATE NOCASE
  `).all(...params);
}

function getCategory(db, id) {
  return db.prepare("SELECT id, name, kind, colour FROM categories WHERE id = ?").get(id);
}

function getCategoryByName(db, name, excludeId) {
  if (excludeId) {
    return db.prepare("SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND id <> ?").get(name, excludeId);
  }
  return db.prepare("SELECT id FROM categories WHERE name = ? COLLATE NOCASE").get(name);
}

function insertCategory(db, category) {
  return db.prepare(`
    INSERT INTO categories (name, kind, colour)
    VALUES (?, ?, ?)
  `).run(category.name, category.kind, category.colour);
}

function updateCategory(db, id, category) {
  return db.prepare(`
    UPDATE categories
    SET name = ?, kind = ?, colour = ?
    WHERE id = ?
  `).run(category.name, category.kind, category.colour, id);
}

function deleteCategory(db, id) {
  return db.prepare("DELETE FROM categories WHERE id = ?").run(id);
}

function getTransactions(db, filters, perPage) {
  const where = [];
  const params = [];

  if (filters.month) {
    where.push("substr(t.transaction_date, 1, 7) = ?");
    params.push(filters.month);
  }
  if (filters.type) {
    where.push("t.type = ?");
    params.push(filters.type);
  }
  if (filters.accountId) {
    where.push("t.account_id = ?");
    params.push(filters.accountId);
  }
  if (filters.categoryId) {
    where.push("t.category_id = ?");
    params.push(filters.categoryId);
  }
  if (filters.search) {
    where.push("(t.description LIKE ? OR c.name LIKE ? OR a.name LIKE ?)");
    const term = `%${filters.search}%`;
    params.push(term, term, term);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    JOIN accounts a ON a.id = t.account_id
    ${whereSql}
  `).get(...params).count);

  const offset = (filters.page - 1) * perPage;
  const rows = db.prepare(`
    SELECT
      t.id,
      t.transaction_date,
      t.description,
      t.type,
      t.amount_cents,
      t.account_id,
      t.category_id,
      a.name AS account_name,
      a.colour AS account_colour,
      c.name AS category_name,
      c.colour AS category_colour
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    JOIN accounts a ON a.id = t.account_id
    ${whereSql}
    ORDER BY t.transaction_date DESC, t.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, perPage, offset);

  return { rows, total };
}

function getTransaction(db, id) {
  return db.prepare(`
    SELECT id, account_id, category_id, type, amount_cents, description, transaction_date
    FROM transactions
    WHERE id = ?
  `).get(id);
}

function getRecentTransactions(db, limit) {
  return db.prepare(`
    SELECT
      t.id,
      t.transaction_date,
      t.description,
      t.type,
      t.amount_cents,
      c.name AS category_name,
      c.colour AS category_colour,
      a.name AS account_name
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    JOIN accounts a ON a.id = t.account_id
    ORDER BY t.transaction_date DESC, t.id DESC
    LIMIT ?
  `).all(limit);
}

function insertTransaction(db, transaction) {
  return db.prepare(`
    INSERT INTO transactions
      (account_id, category_id, type, amount_cents, description, transaction_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    transaction.accountId,
    transaction.categoryId,
    transaction.type,
    transaction.amountCents,
    transaction.description,
    transaction.transactionDate
  );
}

function updateTransaction(db, id, transaction) {
  return db.prepare(`
    UPDATE transactions
    SET account_id = ?, category_id = ?, type = ?, amount_cents = ?, description = ?, transaction_date = ?
    WHERE id = ?
  `).run(
    transaction.accountId,
    transaction.categoryId,
    transaction.type,
    transaction.amountCents,
    transaction.description,
    transaction.transactionDate,
    id
  );
}

function deleteTransaction(db, id) {
  return db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
}

function getMonthSummary(db, month) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'income' THEN amount_cents END), 0) AS income_cents,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents END), 0) AS expense_cents
    FROM transactions
    WHERE substr(transaction_date, 1, 7) = ?
  `).get(month);
  const incomeCents = Number(row.income_cents) || 0;
  const expenseCents = Number(row.expense_cents) || 0;
  const netCents = incomeCents - expenseCents;
  return {
    incomeCents,
    expenseCents,
    netCents,
    savingsRate: incomeCents > 0 ? Math.round((netCents / incomeCents) * 1000) / 10 : null,
  };
}

function getSpendingByCategory(db, month) {
  return db.prepare(`
    SELECT
      c.id,
      c.name,
      c.colour,
      SUM(t.amount_cents) AS amount_cents,
      COUNT(t.id) AS transaction_count
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE t.type = 'expense' AND substr(t.transaction_date, 1, 7) = ?
    GROUP BY c.id
    ORDER BY amount_cents DESC
  `).all(month).map((row) => ({
    id: Number(row.id),
    name: row.name,
    colour: row.colour,
    amountCents: Number(row.amount_cents),
    transactionCount: Number(row.transaction_count),
  }));
}

function getMonthlyTrend(db, endMonth, count) {
  const start = new Date(`${endMonth}-01T12:00:00`);
  const months = [];
  for (let offset = -(count - 1); offset <= 0; offset += 1) {
    months.push(monthKeyOffset(start, offset));
  }

  const rows = db.prepare(`
    SELECT
      substr(transaction_date, 1, 7) AS month,
      COALESCE(SUM(CASE WHEN type = 'income' THEN amount_cents END), 0) AS income_cents,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents END), 0) AS expense_cents
    FROM transactions
    WHERE substr(transaction_date, 1, 7) BETWEEN ? AND ?
    GROUP BY month
    ORDER BY month
  `).all(months[0], months[months.length - 1]);

  const byMonth = new Map(rows.map((row) => [row.month, row]));
  const label = new Intl.DateTimeFormat("en-IE", { month: "short", year: "numeric" });
  return months.map((month) => {
    const row = byMonth.get(month);
    const date = new Date(`${month}-01T12:00:00`);
    return {
      month,
      label: label.format(date),
      incomeCents: row ? Number(row.income_cents) : 0,
      expenseCents: row ? Number(row.expense_cents) : 0,
    };
  });
}

function getBudgetStatus(db, month) {
  return db.prepare(`
    SELECT
      c.id,
      c.name,
      c.colour,
      COALESCE(b.amount_cents, 0) AS budget_cents,
      COALESCE(s.spent_cents, 0) AS spent_cents
    FROM categories c
    LEFT JOIN budgets b ON b.category_id = c.id AND b.month = ?
    LEFT JOIN (
      SELECT category_id, SUM(amount_cents) AS spent_cents
      FROM transactions
      WHERE type = 'expense' AND substr(transaction_date, 1, 7) = ?
      GROUP BY category_id
    ) s ON s.category_id = c.id
    WHERE c.kind = 'expense'
    ORDER BY c.name COLLATE NOCASE
  `).all(month, month).map((row) => {
    const budgetCents = Number(row.budget_cents);
    const spentCents = Number(row.spent_cents);
    const remainingCents = budgetCents - spentCents;
    return {
      id: Number(row.id),
      name: row.name,
      colour: row.colour,
      budgetCents,
      spentCents,
      remainingCents,
      percent: budgetCents > 0 ? Math.round((spentCents / budgetCents) * 100) : null,
    };
  });
}

function getDashboardData(db, month) {
  return {
    month,
    totalBalanceCents: getTotalBalanceCents(db),
    summary: getMonthSummary(db, month),
    spendingByCategory: getSpendingByCategory(db, month),
    monthlyTrend: getMonthlyTrend(db, month, 6),
    budgetStatus: getBudgetStatus(db, month)
      .filter((item) => item.budgetCents > 0 || item.spentCents > 0)
      .sort((a, b) => b.spentCents - a.spentCents)
      .slice(0, 6),
    recentTransactions: getRecentTransactions(db, 8),
  };
}

function getAvailableMonths(db) {
  const rows = db.prepare(`
    SELECT DISTINCT substr(transaction_date, 1, 7) AS month
    FROM transactions
    ORDER BY month DESC
  `).all();
  const months = rows.map((row) => row.month);
  const current = new Date();
  for (let offset = 0; offset < 12; offset += 1) {
    const key = monthKeyOffset(current, -offset);
    if (months.indexOf(key) === -1) months.push(key);
  }
  return months.sort().reverse();
}

function upsertBudget(db, categoryId, month, amountCents) {
  return db.prepare(`
    INSERT INTO budgets (category_id, month, amount_cents)
    VALUES (?, ?, ?)
    ON CONFLICT(category_id, month) DO UPDATE SET amount_cents = excluded.amount_cents
  `).run(categoryId, month, amountCents);
}

function deleteBudget(db, categoryId, month) {
  return db.prepare("DELETE FROM budgets WHERE category_id = ? AND month = ?").run(categoryId, month);
}

module.exports = {
  getTotalBalanceCents,
  getAccounts,
  getAccountsWithBalances,
  getAccount,
  getAccountByName,
  insertAccount,
  updateAccount,
  deleteAccount,
  getCategories,
  getCategory,
  getCategoryByName,
  insertCategory,
  updateCategory,
  deleteCategory,
  getTransactions,
  getTransaction,
  getRecentTransactions,
  insertTransaction,
  updateTransaction,
  deleteTransaction,
  getMonthSummary,
  getSpendingByCategory,
  getMonthlyTrend,
  getBudgetStatus,
  getDashboardData,
  getAvailableMonths,
  upsertBudget,
  deleteBudget,
};
