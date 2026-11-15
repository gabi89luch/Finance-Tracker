(function () {
  "use strict";

  const dataElement = document.getElementById("budget-data");
  if (!dataElement || typeof Chart === "undefined") return;

  let data;
  try {
    data = JSON.parse(dataElement.textContent);
  } catch (error) {
    console.error("Could not read budget data", error);
    return;
  }

  const canvas = document.getElementById("budgetChart");
  if (!canvas) return;

  const rows = (data.status || []).filter(function (item) {
    return item.budgetCents > 0 || item.spentCents > 0;
  });

  if (!rows.length) {
    canvas.hidden = true;
    return;
  }

  const currency = new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });

  const toEuro = function (cents) {
    return currency.format((Number(cents) || 0) / 100);
  };

  Chart.defaults.font.family = "'Inter', ui-sans-serif, system-ui, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = "#64748b";

  new Chart(canvas, {
    type: "bar",
    data: {
      labels: rows.map(function (item) { return item.name; }),
      datasets: [
        {
          label: "Budget",
          data: rows.map(function (item) { return item.budgetCents / 100; }),
          backgroundColor: "#d4cdc0",
          borderRadius: 5,
          maxBarThickness: 18,
        },
        {
          label: "Spent",
          data: rows.map(function (item) { return item.spentCents / 100; }),
          backgroundColor: rows.map(function (item) {
            return item.budgetCents > 0 && item.spentCents > item.budgetCents ? "#9B2226" : "#1B4D5C";
          }),
          borderRadius: 5,
          maxBarThickness: 18,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 8, padding: 16 },
        },
        tooltip: {
          backgroundColor: "#1a1a1a",
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: function (context) {
              return context.dataset.label + ": " + toEuro(context.parsed.x * 100);
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: "#e8e2d8" },
          ticks: {
            color: "#6b6560",
            callback: function (value) {
              return value >= 1000 ? "EUR " + value / 1000 + "k" : "EUR " + value;
            },
          },
        },
        y: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: "#6b6560" },
        },
      },
    },
  });
})();
