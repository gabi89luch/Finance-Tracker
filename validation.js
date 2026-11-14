function todayISO() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function currentMonthKey() {
  return todayISO().slice(0, 7);
}

function isValidMonth(value) {
  if (!/^\d{4}-\d{2}$/.test(String(value || ""))) return false;
  const month = Number(String(value).slice(5, 7));
  return month >= 1 && month <= 12;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function parseId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function parseMoneyToCents(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return { error: "Enter an amount." };
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    return { error: "Enter a valid amount with up to 2 decimal places." };
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Amount must be greater than zero." };
  }
  if (amount > 1000000) {
    return { error: "Amount must be 1,000,000 or less." };
  }
  return { cents: Math.round(amount * 100) };
}

function parseSignedMoneyToCents(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return { cents: 0 };
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) {
    return { error: "Enter a valid amount with up to 2 decimal places." };
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < -1000000 || amount > 1000000) {
    return { error: "Opening balance must be between -1,000,000 and 1,000,000." };
  }
  return { cents: Math.round(amount * 100) };
}

function validateTransaction(input, accounts, categories) {
  const values = {
    type: String(input.type || "").trim(),
    transactionDate: String(input.transaction_date || "").trim(),
    description: String(input.description || "").trim(),
    amount: String(input.amount || "").trim(),
    accountId: parseId(input.account_id),
    categoryId: parseId(input.category_id),
  };
  const errors = {};

  if (values.type !== "income" && values.type !== "expense") {
    errors.type = "Choose income or expense.";
  }

  if (!isValidDate(values.transactionDate)) {
    errors.transactionDate = "Enter a valid date.";
  } else if (values.transactionDate > todayISO()) {
    errors.transactionDate = "The date cannot be in the future.";
  } else if (values.transactionDate < "2000-01-01") {
    errors.transactionDate = "The date must be 1 January 2000 or later.";
  }

  if (values.description.length < 2) {
    errors.description = "Enter a description of at least 2 characters.";
  } else if (values.description.length > 120) {
    errors.description = "Description must be 120 characters or fewer.";
  }

  const money = parseMoneyToCents(values.amount);
  if (money.error) errors.amount = money.error;

  const account = accounts.find((item) => Number(item.id) === values.accountId);
  if (!account) errors.accountId = "Choose a valid account.";

  const category = categories.find((item) => Number(item.id) === values.categoryId);
  if (!category) {
    errors.categoryId = "Choose a valid category.";
  } else if (category.kind !== values.type) {
    errors.categoryId = "Choose a category that matches the transaction type.";
  }

  return { values, errors, amountCents: money.cents || 0 };
}

function validateAccount(input, existingAccounts, excludeId) {
  const values = {
    name: String(input.name || "").trim(),
    type: String(input.type || "").trim(),
    openingBalance: String(input.opening_balance || "").trim(),
    colour: String(input.colour || "#2563eb").trim(),
  };
  const errors = {};
  const validTypes = ["current", "savings", "credit", "cash"];

  if (values.name.length < 2) {
    errors.name = "Enter an account name of at least 2 characters.";
  } else if (values.name.length > 40) {
    errors.name = "Account name must be 40 characters or fewer.";
  } else if (existingAccounts.some((account) => (
    account.name.toLowerCase() === values.name.toLowerCase()
    && Number(account.id) !== Number(excludeId || 0)
  ))) {
    errors.name = "An account with this name already exists.";
  }

  if (!validTypes.includes(values.type)) {
    errors.type = "Choose a valid account type.";
  }

  const balance = parseSignedMoneyToCents(values.openingBalance);
  if (balance.error) errors.openingBalance = balance.error;

  if (!/^#[0-9a-f]{6}$/i.test(values.colour)) {
    errors.colour = "Choose a valid colour.";
  }

  return { values, errors, openingBalanceCents: balance.cents || 0 };
}

function validateCategory(input, existingCategories, excludeId) {
  const values = {
    name: String(input.name || "").trim(),
    kind: String(input.kind || "").trim(),
    colour: String(input.colour || "#64748b").trim(),
  };
  const errors = {};

  if (values.name.length < 2) {
    errors.name = "Enter a category name of at least 2 characters.";
  } else if (values.name.length > 40) {
    errors.name = "Category name must be 40 characters or fewer.";
  } else if (existingCategories.some((category) => (
    category.name.toLowerCase() === values.name.toLowerCase()
    && Number(category.id) !== Number(excludeId || 0)
  ))) {
    errors.name = "A category with this name already exists.";
  }

  if (values.kind !== "income" && values.kind !== "expense") {
    errors.kind = "Choose income or expense.";
  }

  if (!/^#[0-9a-f]{6}$/i.test(values.colour)) {
    errors.colour = "Choose a valid colour.";
  }

  return { values, errors };
}

function monthOptions(count) {
  const options = [];
  const now = new Date();
  const label = new Intl.DateTimeFormat("en-IE", { month: "short", year: "numeric" });
  for (let offset = 0; offset < count; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    options.push({ value, label: label.format(date) });
  }
  return options;
}

function formatMonthLabel(month) {
  if (!isValidMonth(month)) return month;
  return new Intl.DateTimeFormat("en-IE", { month: "long", year: "numeric" })
    .format(new Date(`${month}-01T12:00:00`));
}

function formatDateLabel(value) {
  if (!isValidDate(value)) return value;
  return new Intl.DateTimeFormat("en-IE", { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date(`${value}T12:00:00`));
}

module.exports = {
  todayISO,
  currentMonthKey,
  isValidMonth,
  isValidDate,
  parseId,
  parseMoneyToCents,
  parseSignedMoneyToCents,
  validateTransaction,
  validateAccount,
  validateCategory,
  monthOptions,
  formatMonthLabel,
  formatDateLabel,
};
