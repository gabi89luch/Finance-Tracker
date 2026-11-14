(function () {
  "use strict";

  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebarBackdrop");
  const menuToggle = document.getElementById("menuToggle");

  function setSidebar(open) {
    if (!sidebar || !backdrop || !menuToggle) return;
    sidebar.classList.toggle("is-open", open);
    backdrop.hidden = !open;
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    document.body.classList.toggle("no-scroll", open);
  }

  if (menuToggle) {
    menuToggle.addEventListener("click", function () {
      setSidebar(!sidebar.classList.contains("is-open"));
    });
  }

  if (backdrop) {
    backdrop.addEventListener("click", function () {
      setSidebar(false);
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") setSidebar(false);
  });

  window.addEventListener("resize", function () {
    if (window.innerWidth >= 1024) setSidebar(false);
  });

  document.querySelectorAll("[data-dismiss-flash]").forEach(function (button) {
    button.addEventListener("click", function () {
      const flash = button.closest(".flash");
      if (flash) flash.remove();
    });
  });

  document.querySelectorAll("form[data-confirm]").forEach(function (form) {
    form.addEventListener("submit", function (event) {
      if (!window.confirm(form.getAttribute("data-confirm"))) {
        event.preventDefault();
      }
    });
  });

  document.querySelectorAll("[data-auto-submit]").forEach(function (field) {
    field.addEventListener("change", function () {
      if (field.form) field.form.submit();
    });
  });

  const typeOptions = document.querySelectorAll("[data-type-option]");
  const categorySelect = document.getElementById("category_id");

  function filterCategories() {
    if (!categorySelect) return;
    const checked = document.querySelector("[data-type-option]:checked");
    const kind = checked ? checked.value : "";
    let selectedVisible = false;

    Array.prototype.forEach.call(categorySelect.options, function (option) {
      if (!option.value) return;
      const matches = !kind || option.dataset.kind === kind;
      option.hidden = !matches;
      option.disabled = !matches;
      if (matches && option.selected) selectedVisible = true;
    });

    if (!selectedVisible) categorySelect.value = "";
  }

  typeOptions.forEach(function (option) {
    option.addEventListener("change", filterCategories);
  });

  filterCategories();
})();
