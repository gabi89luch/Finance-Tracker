(function () {
  "use strict";

  const dataElement = document.getElementById("dashboard-data");
  if (!dataElement || typeof Chart === "undefined") return;

  let data;
  try {
    data = JSON.parse(dataElement.textContent);
  } catch (error) {
    console.error("Could not read dashboard data", error);
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

  const tooltipOptions = {
    backgroundColor: "#1a1a1a",
    padding: 10,
    cornerRadius: 8,
    titleFont: { weight: "600" },
  };

  const spendingCanvas = document.getElementById("spendingChart");
  const spendingEmpty = document.getElementById("spendingEmpty");
  const spending = data.spendingByCategory || [];

  if (spendingCanvas && spending.length) {
    new Chart(spendingCanvas, {
      type: "doughnut",
      data: {
        labels: spending.map(function (item) { return item.name; }),
        datasets: [{
          data: spending.map(function (item) { return item.amountCents / 100; }),
          backgroundColor: spending.map(function (item) { return item.colour; }),
          borderColor: "#ffffff",
          borderWidth: 2,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: { display: false },
          tooltip: Object.assign({}, tooltipOptions, {
            callbacks: {
              label: function (context) {
                const total = spending.reduce(function (sum, item) { return sum + item.amountCents; }, 0);
                const value = context.parsed;
                const share = total ? Math.round((value / (total / 100)) * 100) : 0;
                return context.label + ": " + toEuro(value * 100) + " (" + share + "%)";
              },
            },
          }),
        },
      },
    });
  } else if (spendingCanvas && spendingEmpty) {
    spendingCanvas.hidden = true;
    spendingEmpty.hidden = false;
  }

  const trendCanvas = document.getElementById("trendChart");
  const trend = data.monthlyTrend || [];

  if (trendCanvas) {
    new Chart(trendCanvas, {
      type: "bar",
      data: {
        labels: trend.map(function (item) { return item.label; }),
        datasets: [
          {
            label: "Income",
            data: trend.map(function (item) { return item.incomeCents / 100; }),
            backgroundColor: "#1B4D5C",
            borderRadius: 6,
            maxBarThickness: 22,
          },
          {
            label: "Expenses",
            data: trend.map(function (item) { return item.expenseCents / 100; }),
            backgroundColor: "#9B2226",
            borderRadius: 6,
            maxBarThickness: 22,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "bottom",
            labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 8, padding: 16 },
          },
          tooltip: Object.assign({}, tooltipOptions, {
            callbacks: {
              label: function (context) {
                return context.dataset.label + ": " + toEuro(context.parsed.y * 100);
              },
            },
          }),
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: "#6b6560" },
          },
          y: {
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
        },
      },
    });
  }
})();
