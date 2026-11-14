const { test } = require("node:test");
const assert = require("node:assert/strict");

const validation = require("../validation");

test("parseMoneyToCents accepts normal amounts", () => {
  assert.equal(validation.parseMoneyToCents("12.34").cents, 1234);
  assert.equal(validation.parseMoneyToCents("7").cents, 700);
  assert.equal(validation.parseMoneyToCents("0.05").cents, 5);
  assert.equal(validation.parseMoneyToCents(" 100.00 ").cents, 10000);
});

test("parseMoneyToCents rejects invalid amounts", () => {
  assert.ok(validation.parseMoneyToCents("").error);
  assert.ok(validation.parseMoneyToCents("12.345").error);
  assert.ok(validation.parseMoneyToCents("-5").error);
  assert.ok(validation.parseMoneyToCents("abc").error);
  assert.ok(validation.parseMoneyToCents("1000001").error);
});

test("parseSignedMoneyToCents allows negative opening balances", () => {
  assert.equal(validation.parseSignedMoneyToCents("-350.00").cents, -35000);
  assert.equal(validation.parseSignedMoneyToCents("").cents, 0);
  assert.ok(validation.parseSignedMoneyToCents("nope").error);
});

test("date validation rejects impossible and malformed dates", () => {
  assert.equal(validation.isValidDate("2024-02-29"), true);
  assert.equal(validation.isValidDate("2025-02-29"), false);
  assert.equal(validation.isValidDate("2026-13-01"), false);
  assert.equal(validation.isValidDate("14/11/2026"), false);
});

test("month validation checks the range", () => {
  assert.equal(validation.isValidMonth("2026-11"), true);
  assert.equal(validation.isValidMonth("2026-00"), false);
  assert.equal(validation.isValidMonth("2026-13"), false);
  assert.equal(validation.isValidMonth("November"), false);
});

test("validateTransaction reports every invalid field", () => {
  const result = validation.validateTransaction(
    {
      type: "transfer",
      transaction_date: "2999-01-01",
      description: "",
      amount: "0",
      account_id: "abc",
      category_id: "0",
    },
    [],
    []
  );

  assert.ok(result.errors.type);
  assert.ok(result.errors.transactionDate);
  assert.ok(result.errors.description);
  assert.ok(result.errors.amount);
  assert.ok(result.errors.accountId);
  assert.ok(result.errors.categoryId);
});

test("validateTransaction accepts matching data", () => {
  const result = validation.validateTransaction(
    {
      type: "expense",
      transaction_date: validation.todayISO(),
      description: "Lunch",
      amount: "9.50",
      account_id: "1",
      category_id: "2",
    },
    [{ id: 1, name: "Current" }],
    [{ id: 2, name: "Eating Out", kind: "expense" }]
  );

  assert.deepEqual(result.errors, {});
  assert.equal(result.amountCents, 950);
});

test("validateAccount rejects duplicate names regardless of case", () => {
  const result = validation.validateAccount(
    { name: "everyday current", type: "current", opening_balance: "0", colour: "#2563eb" },
    [{ id: 1, name: "Everyday Current" }]
  );
  assert.match(result.errors.name, /already exists/);
});

test("validateCategory rejects an unknown kind", () => {
  const result = validation.validateCategory(
    { name: "Pets", kind: "other", colour: "#0ea5e9" },
    []
  );
  assert.ok(result.errors.kind);
});

test("month options return the requested number of valid months", () => {
  const options = validation.monthOptions(12);
  assert.equal(options.length, 12);
  options.forEach((option) => {
    assert.equal(validation.isValidMonth(option.value), true);
    assert.ok(option.label.length > 0);
  });
});
