const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { initDb } = require("../db");
const { createApp } = require("../app");
const queries = require("../queries");

let db;
let app;

beforeEach(() => {
  db = initDb(":memory:");
  app = createApp(db);
});

afterEach(() => {
  db.close();
});

function expenseCategory(name) {
  return queries.getCategories(db, "expense").find((category) => category.name === name);
}

function firstAccount() {
  return queries.getAccounts(db)[0];
}

test("health endpoint reports ok", async () => {
  const response = await request(app).get("/api/health");
  assert.equal(response.status, 200);
  assert.equal(response.body.status, "ok");
});

test("dashboard renders key figures, charts and serialised data", async () => {
  const response = await request(app).get("/");
  assert.equal(response.status, 200);
  assert.match(response.text, /Total balance/);
  assert.match(response.text, /id="spendingChart"/);
  assert.match(response.text, /id="trendChart"/);
  assert.match(response.text, /id="dashboard-data"/);
  assert.match(response.text, /Recent transactions/);
});

test("dashboard API returns the expected shape", async () => {
  const response = await request(app).get("/api/dashboard");
  assert.equal(response.status, 200);
  assert.equal(typeof response.body.totalBalanceCents, "number");
  assert.equal(typeof response.body.summary.incomeCents, "number");
  assert.equal(typeof response.body.summary.expenseCents, "number");
  assert.equal(response.body.monthlyTrend.length, 6);
  assert.ok(Array.isArray(response.body.spendingByCategory));
  assert.ok(Array.isArray(response.body.budgetStatus));
});

test("transactions page paginates and keeps filters", async () => {
  const first = await request(app).get("/transactions");
  assert.equal(first.status, 200);
  assert.match(first.text, /Page 1 of 11/);

  const second = await request(app).get("/transactions?page=2");
  assert.equal(second.status, 200);
  assert.match(second.text, /Page 2 of 11/);

  const filtered = await request(app).get("/transactions?type=income&month=2026-11");
  assert.equal(filtered.status, 200);
  assert.match(filtered.text, /value="income" selected/);
});

test("a valid transaction is stored in cents and redirects", async () => {
  const account = firstAccount();
  const category = expenseCategory("Groceries");
  const before = db.prepare("SELECT COUNT(*) AS count FROM transactions").get().count;

  const response = await request(app)
    .post("/transactions")
    .type("form")
    .send({
      type: "expense",
      transaction_date: "2026-11-14",
      description: "Test grocery run",
      amount: "12.34",
      account_id: String(account.id),
      category_id: String(category.id),
    });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, "/transactions");

  const after = db.prepare("SELECT COUNT(*) AS count FROM transactions").get().count;
  assert.equal(Number(after), Number(before) + 1);

  const row = db.prepare("SELECT * FROM transactions WHERE description = ?").get("Test grocery run");
  assert.equal(Number(row.amount_cents), 1234);
  assert.equal(row.type, "expense");
});

test("invalid transactions are rejected with field errors", async () => {
  const response = await request(app)
    .post("/transactions")
    .type("form")
    .send({
      type: "expense",
      transaction_date: "2099-01-01",
      description: "x",
      amount: "-5",
      account_id: "999",
      category_id: "999",
    });

  assert.equal(response.status, 422);
  assert.match(response.text, /The date cannot be in the future/);
  assert.match(response.text, /at least 2 characters/);
  assert.match(response.text, /valid amount/);
  assert.match(response.text, /Choose a valid account/);
  assert.match(response.text, /Choose a valid category/);
});

test("a category that does not match the transaction type is rejected", async () => {
  const salary = queries.getCategories(db, "income").find((category) => category.name === "Salary");

  const response = await request(app)
    .post("/transactions")
    .type("form")
    .send({
      type: "expense",
      transaction_date: "2026-11-14",
      description: "Mismatched entry",
      amount: "10.00",
      account_id: String(firstAccount().id),
      category_id: String(salary.id),
    });

  assert.equal(response.status, 422);
  assert.match(response.text, /Choose a category that matches the transaction type/);
});

test("transactions can be edited and deleted", async () => {
  const row = db.prepare("SELECT * FROM transactions ORDER BY id LIMIT 1").get();

  const editPage = await request(app).get(`/transactions/${row.id}/edit`);
  assert.equal(editPage.status, 200);
  assert.match(editPage.text, /Edit transaction/);

  const updated = await request(app)
    .post(`/transactions/${row.id}`)
    .type("form")
    .send({
      type: row.type,
      transaction_date: row.transaction_date,
      description: "Updated description",
      amount: "99.99",
      account_id: String(row.account_id),
      category_id: String(row.category_id),
    });

  assert.equal(updated.status, 302);
  const afterUpdate = db.prepare("SELECT * FROM transactions WHERE id = ?").get(row.id);
  assert.equal(afterUpdate.description, "Updated description");
  assert.equal(Number(afterUpdate.amount_cents), 9999);

  const removed = await request(app).post(`/transactions/${row.id}/delete`);
  assert.equal(removed.status, 302);
  assert.equal(db.prepare("SELECT * FROM transactions WHERE id = ?").get(row.id), undefined);
});

test("descriptions are escaped in the HTML", async () => {
  const category = expenseCategory("Groceries");

  await request(app)
    .post("/transactions")
    .type("form")
    .send({
      type: "expense",
      transaction_date: "2026-11-14",
      description: "<script>alert(1)</script>",
      amount: "5.00",
      account_id: String(firstAccount().id),
      category_id: String(category.id),
    });

  const response = await request(app).get("/transactions");
  assert.equal(response.status, 200);
  assert.ok(!response.text.includes("<script>alert(1)</script>"));
  assert.match(response.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("accounts validate duplicates and can be created", async () => {
  const duplicate = await request(app)
    .post("/accounts")
    .type("form")
    .send({ name: "Everyday Current", type: "current", opening_balance: "0", colour: "#2563eb" });
  assert.equal(duplicate.status, 422);
  assert.match(duplicate.text, /An account with this name already exists/);

  const created = await request(app)
    .post("/accounts")
    .type("form")
    .send({ name: "Test Savings", type: "savings", opening_balance: "250.50", colour: "#059669" });
  assert.equal(created.status, 302);

  const account = db.prepare("SELECT * FROM accounts WHERE name = ?").get("Test Savings");
  assert.equal(Number(account.opening_balance_cents), 25050);
});

test("an account with transactions cannot be deleted", async () => {
  const account = firstAccount();
  const agent = request.agent(app);

  const response = await agent.post(`/accounts/${account.id}/delete`);
  assert.equal(response.status, 302);

  const page = await agent.get("/accounts");
  assert.match(page.text, /That account still has transactions/);
  assert.ok(queries.getAccount(db, account.id));
});

test("categories validate duplicates and usage before deletion", async () => {
  const duplicate = await request(app)
    .post("/categories")
    .type("form")
    .send({ name: "Groceries", kind: "expense", colour: "#16a34a" });
  assert.equal(duplicate.status, 422);
  assert.match(duplicate.text, /A category with this name already exists/);

  const created = await request(app)
    .post("/categories")
    .type("form")
    .send({ name: "Pet care", kind: "expense", colour: "#0ea5e9" });
  assert.equal(created.status, 302);

  const category = db.prepare("SELECT * FROM categories WHERE name = ?").get("Pet care");
  assert.ok(category);

  const inUse = expenseCategory("Rent");
  const agent = request.agent(app);
  await agent.post(`/categories/${inUse.id}/delete`);
  const page = await agent.get("/categories");
  assert.match(page.text, /That category is used by transactions or budgets/);
  assert.ok(queries.getCategory(db, inUse.id));
});

test("budgets are created, updated and removed for a month", async () => {
  const month = "2026-01";
  const category = expenseCategory("Groceries");
  const field = `budget_${category.id}`;

  const page = await request(app).get(`/budgets?month=${month}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /id="budgetChart"/);
  assert.match(page.text, /id="budget-data"/);

  const created = await request(app)
    .post("/budgets")
    .type("form")
    .send({ month, [field]: "400.00" });
  assert.equal(created.status, 302);

  let row = db.prepare("SELECT * FROM budgets WHERE category_id = ? AND month = ?").get(category.id, month);
  assert.equal(Number(row.amount_cents), 40000);

  const updated = await request(app)
    .post("/budgets")
    .type("form")
    .send({ month, [field]: "450.50" });
  assert.equal(updated.status, 302);

  const count = db
    .prepare("SELECT COUNT(*) AS count FROM budgets WHERE category_id = ? AND month = ?")
    .get(category.id, month);
  assert.equal(Number(count.count), 1);

  row = db.prepare("SELECT * FROM budgets WHERE category_id = ? AND month = ?").get(category.id, month);
  assert.equal(Number(row.amount_cents), 45050);

  const removed = await request(app)
    .post("/budgets")
    .type("form")
    .send({ month, [field]: "" });
  assert.equal(removed.status, 302);
  assert.equal(
    db.prepare("SELECT * FROM budgets WHERE category_id = ? AND month = ?").get(category.id, month),
    undefined
  );
});

test("invalid budget amounts return a validation error", async () => {
  const category = expenseCategory("Groceries");
  const response = await request(app)
    .post("/budgets")
    .type("form")
    .send({ month: "2026-11", [`budget_${category.id}`]: "abc" });

  assert.equal(response.status, 422);
  assert.match(response.text, /Enter a valid amount/);
});

test("unknown pages return the custom 404 page", async () => {
  const response = await request(app).get("/this-page-does-not-exist");
  assert.equal(response.status, 404);
  assert.match(response.text, /The page you asked for does not exist/);
});

test("the database trigger blocks a mismatched transaction", () => {
  const salary = queries.getCategories(db, "income").find((category) => category.name === "Salary");
  assert.throws(() => {
    db.prepare(`
      INSERT INTO transactions
        (account_id, category_id, type, amount_cents, description, transaction_date)
      VALUES (?, ?, 'expense', 100, 'Trigger test', '2026-11-14')
    `).run(firstAccount().id, salary.id);
  }, /transaction type does not match category kind/);
});

test("budget upserts are idempotent", () => {
  const category = expenseCategory("Rent");
  const month = "2026-02";
  queries.upsertBudget(db, category.id, month, 1000);
  queries.upsertBudget(db, category.id, month, 2000);

  const rows = db.prepare("SELECT * FROM budgets WHERE category_id = ? AND month = ?").all(category.id, month);
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].amount_cents), 2000);
});
