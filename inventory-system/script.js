/* =========================================================
   System Pagla - script.js
   Plain JavaScript only. Sections:
     1. Settings & data
     2. Pure helper functions (no screen needed, easy to test)
     3. Saving / loading (localStorage) and multi-tab safety
     4. Screen helpers (toast, confirm panel, messages)
     5. Page switching
     6. Dashboard
     7. Products (add, edit, delete, search, filter, sort)
     8. New sale (cart + checkout)
     9. Sales history
    10. Start the app
   ========================================================= */

/* ---------------------------------------------------------
   1. SETTINGS & DATA
   --------------------------------------------------------- */
const PRODUCTS_KEY = "sis_products";
const SALES_KEY = "sis_sales";

const DISCOUNT_LIMIT = 10000;   // discount starts at this subtotal
const DISCOUNT_RATE = 0.10;     // 10%
const TAX_RATE = 0.05;          // 5%

// Limits used by the product form
const LIMITS = {
  idLength: 20,
  nameLength: 60,
  categoryLength: 30,
  maxPrice: 100000000,
  maxQuantity: 1000000
};

// These change while the app runs, so they use "let"
let products = [];        // all products
let sales = [];           // all completed sales
let cart = [];            // current cart: [{ id: "PRD-001", qty: 2 }]
let editingId = null;     // null = adding a new product, otherwise the ID being edited
let loadProblems = 0;     // how many damaged records were skipped when loading
let storageWorks = true;  // false if the browser blocks localStorage
let confirmCallback = null; // what to do when the user presses "Yes" in the confirm panel
let toastTimer = null;

/* ---------------------------------------------------------
   2. PURE HELPER FUNCTIONS
   These only use the values you give them. They do not touch
   the screen, so tests.html can check them directly.
   --------------------------------------------------------- */

// Round to 2 decimals (avoids 0.1 + 0.2 problems)
function round2(n) {
  return Math.round(n * 100) / 100;
}

// 12500 -> "PKR 12,500.00" (always 2 decimals)
function money(amount) {
  return "PKR " + round2(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// Is this a normal finite number? (not text, not NaN, not Infinity)
function isNumber(value) {
  return typeof value === "number" && isFinite(value);
}

// Find a product in a list by ID. Returns null if not found.
function findIn(list, id) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

// "ok", "low" or "out" for a product
function stockStatus(p) {
  if (p.quantity === 0) return "out";
  if (p.quantity <= p.minStock) return "low";
  return "ok";
}

// Date as YYYY-MM-DD in the user's local time (used for the date filter)
function dateOnly(isoText) {
  const d = new Date(isoText);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + month + "-" + day;
}

// Remove broken products (missing fields, bad numbers, duplicate IDs).
function cleanProducts(list) {
  const good = [];
  const seenIds = new Set();   // a Set is safe even for IDs like "constructor"

  list.forEach(function (p) {
    if (!p || typeof p !== "object") return;

    const id = String(p.id || "").trim();
    const name = String(p.name || "").trim();
    const purchase = p.purchasePrice;
    const selling = p.sellingPrice;
    const qty = p.quantity;
    let min = p.minStock;

    if (!id || !name) return;
    if (seenIds.has(id.toLowerCase())) return;
    if (!isNumber(purchase) || purchase <= 0) return;
    if (!isNumber(selling) || selling <= 0) return;
    if (!Number.isInteger(qty) || qty < 0) return;
    if (!Number.isInteger(min) || min < 0) min = 0;

    seenIds.add(id.toLowerCase());
    good.push({
      id: id,
      name: name,
      category: String(p.category || "General").trim() || "General",
      purchasePrice: purchase,
      sellingPrice: selling,
      quantity: qty,
      minStock: min
    });
  });
  return good;
}

// Remove broken sales. A sale is kept only if EVERYTHING in it is valid and
// its numbers add up. We never keep half a sale, so history always matches.
function cleanSales(list) {
  const good = [];
  const seenIds = new Set();

  list.forEach(function (s) {
    if (!s || typeof s !== "object") return;

    const id = String(s.id || "");
    if (!id || seenIds.has(id)) return;
    if (typeof s.time !== "string" || isNaN(new Date(s.time).getTime())) return;
    if (!Array.isArray(s.items) || s.items.length === 0) return;
    if (!isNumber(s.subtotal) || !isNumber(s.discount) || !isNumber(s.tax) || !isNumber(s.total)) return;

    // check every item
    let itemsOk = true;
    let itemsSum = 0;
    s.items.forEach(function (item) {
      if (!item || !item.id || !item.name || !isNumber(item.price) || item.price < 0 ||
          !Number.isInteger(item.qty) || item.qty < 1) {
        itemsOk = false;
        return;
      }
      itemsSum += item.price * item.qty;
    });
    if (!itemsOk) return;

    // check that the numbers add up
    if (Math.abs(round2(itemsSum) - s.subtotal) > 0.01) return;
    if (Math.abs(round2(s.subtotal - s.discount + s.tax) - s.total) > 0.01) return;

    seenIds.add(id);
    good.push({
      id: id,
      time: s.time,
      items: s.items.map(function (item) {
        return {
          id: String(item.id),
          name: String(item.name),
          price: item.price,
          qty: item.qty,
          lineTotal: round2(item.price * item.qty)
        };
      }),
      subtotal: s.subtotal,
      discount: s.discount,
      tax: s.tax,
      total: s.total
    });
  });
  return good;
}

// Subtotal, discount, tax and total for cart lines
function calculateTotals(lines, productList) {
  let subtotal = 0;
  lines.forEach(function (line) {
    const p = findIn(productList, line.id);
    if (p) subtotal += p.sellingPrice * line.qty;
  });
  subtotal = round2(subtotal);

  const discount = subtotal >= DISCOUNT_LIMIT ? round2(subtotal * DISCOUNT_RATE) : 0;
  const afterDiscount = round2(subtotal - discount);
  const tax = round2(afterDiscount * TAX_RATE);
  const total = round2(afterDiscount + tax);

  return { subtotal: subtotal, discount: discount, tax: tax, total: total };
}

// Next sale ID: SALE-0001, SALE-0002 ...
function nextSaleId(salesList) {
  let highest = 0;
  salesList.forEach(function (s) {
    const match = /^SALE-(\d+)$/.exec(s.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  });
  return "SALE-" + String(highest + 1).padStart(4, "0");
}

// Top-selling product by total units sold.
// Sales are grouped by product ID (not name), so renaming a product keeps its history
// and two products with the same name stay separate.
// The name shown is the product's current name, or its newest name in the sales if deleted.
function topSellingProduct(salesList, productList) {
  const units = new Map();      // id -> total units
  const newestName = new Map(); // id -> name used in the newest sale
  const newestTime = new Map(); // id -> time of that sale

  salesList.forEach(function (sale) {
    const time = new Date(sale.time).getTime();
    sale.items.forEach(function (item) {
      units.set(item.id, (units.get(item.id) || 0) + item.qty);
      if (!newestTime.has(item.id) || time >= newestTime.get(item.id)) {
        newestTime.set(item.id, time);
        newestName.set(item.id, item.name);
      }
    });
  });

  let topId = null;
  let topUnits = 0;
  units.forEach(function (count, id) {
    if (count > topUnits) {
      topUnits = count;
      topId = id;
    }
  });
  if (topId === null) return null;

  const current = findIn(productList, topId);
  return {
    id: topId,
    name: current ? current.name : newestName.get(topId),
    units: topUnits
  };
}

// Check the product form values. Returns an error message, or "" if all is fine.
// "values" holds the raw text from the form.
function validateProduct(values, productList, editId) {
  if (!values.id) return "Product ID is required.";
  if (!values.name) return "Product name is required.";
  if (!values.category) return "Category is required.";
  if (values.purchase === "") return "Purchase price is required.";
  if (values.selling === "") return "Selling price is required.";
  if (values.quantity === "") return "Quantity is required.";
  if (values.min === "") return "Minimum stock is required.";

  if (values.id.length > LIMITS.idLength) return "Product ID must be " + LIMITS.idLength + " characters or less.";
  if (values.name.length > LIMITS.nameLength) return "Name must be " + LIMITS.nameLength + " characters or less.";
  if (values.category.length > LIMITS.categoryLength) return "Category must be " + LIMITS.categoryLength + " characters or less.";

  const purchase = Number(values.purchase);
  const selling = Number(values.selling);
  const qty = Number(values.quantity);
  const min = Number(values.min);

  if (!isFinite(purchase) || purchase <= 0) return "Purchase price must be a number more than 0.";
  if (!isFinite(selling) || selling <= 0) return "Selling price must be a number more than 0.";
  if (purchase > LIMITS.maxPrice || selling > LIMITS.maxPrice) return "Prices cannot be more than PKR 100,000,000.";
  if (!Number.isInteger(qty) || qty < 0) return "Quantity must be a whole number (0 or more).";
  if (!Number.isInteger(min) || min < 0) return "Minimum stock must be a whole number (0 or more).";
  if (qty > LIMITS.maxQuantity || min > LIMITS.maxQuantity) return "Quantity cannot be more than 1,000,000.";

  // duplicate ID check (only when adding a new product)
  if (editId === null) {
    const exists = productList.some(function (p) {
      return p.id.toLowerCase() === values.id.toLowerCase();
    });
    if (exists) return 'A product with ID "' + values.id + '" already exists.';
  }
  return "";
}

/* ---------------------------------------------------------
   3. SAVING / LOADING AND MULTI-TAB SAFETY

   Problem: if the app is open in two tabs, each tab keeps its
   own copy in memory. If a tab saved its old copy, it would
   erase what the other tab did.

   Solution:
     - Before EVERY change we re-read the newest data from
       localStorage (reloadFromStorage), apply the change, save.
     - When another tab saves, the "storage" event tells us, and
       we refresh the screen.
   --------------------------------------------------------- */

// Read a list from localStorage. If anything is wrong, return an empty list.
function loadList(key) {
  try {
    const text = localStorage.getItem(key);
    if (!text) return [];
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

// Find out if the browser lets us save data
function checkStorageWorks() {
  try {
    localStorage.setItem("sis_test", "1");
    localStorage.removeItem("sis_test");
    storageWorks = true;
  } catch (e) {
    storageWorks = false;
  }
}

// Load the newest saved data into memory (and clean it)
function reloadFromStorage() {
  if (!storageWorks) return; // nothing to read, keep what is in memory
  const rawProducts = loadList(PRODUCTS_KEY);
  const rawSales = loadList(SALES_KEY);
  products = cleanProducts(rawProducts);
  sales = cleanSales(rawSales);
  loadProblems = (rawProducts.length - products.length) + (rawSales.length - sales.length);
  updateNotice();
}

// Save both lists. Returns true if it worked, false if the browser refused.
// If the second save fails we put the first one back, so the two never disagree.
function saveAll() {
  if (!storageWorks) return true; // memory only (a notice already warns the user)

  let oldProducts = null;
  let oldSales = null;
  try {
    oldProducts = localStorage.getItem(PRODUCTS_KEY);
    oldSales = localStorage.getItem(SALES_KEY);
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
    localStorage.setItem(SALES_KEY, JSON.stringify(sales));
    return true;
  } catch (e) {
    try {
      if (oldProducts === null) localStorage.removeItem(PRODUCTS_KEY);
      else localStorage.setItem(PRODUCTS_KEY, oldProducts);
      if (oldSales === null) localStorage.removeItem(SALES_KEY);
      else localStorage.setItem(SALES_KEY, oldSales);
    } catch (e2) {
      // nothing more we can do
    }
    return false;
  }
}

// The safe way to change data:
//   1) load the newest data  2) run your change  3) save
// "applyChange" must return "" when it worked, or an error message.
// If it fails (or saving fails) the data is put back exactly as it was.
function changeData(applyChange) {
  reloadFromStorage();
  const backupProducts = JSON.stringify(products);
  const backupSales = JSON.stringify(sales);

  const error = applyChange();
  if (error) {
    products = JSON.parse(backupProducts);
    sales = JSON.parse(backupSales);
    return error;
  }

  if (!saveAll()) {
    products = JSON.parse(backupProducts);
    sales = JSON.parse(backupSales);
    return "Could not save. Your browser storage may be full or blocked. Nothing was changed.";
  }
  return "";
}

// Runs when ANOTHER tab saves data
function onStorageChange(e) {
  const relevant = e.key === null || e.key === PRODUCTS_KEY || e.key === SALES_KEY;
  if (!relevant) return;
  showPage(currentPageName()); // showPage reloads the newest data and redraws
  toast("Data was updated in another tab");
}

/* ---------------------------------------------------------
   4. SCREEN HELPERS
   --------------------------------------------------------- */

// Shortcut: document.getElementById
function $(id) {
  return document.getElementById(id);
}

// Make text safe before putting it inside HTML
function esc(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function statusBadge(p) {
  const s = stockStatus(p);
  if (s === "out") return '<span class="badge out">Out of stock</span>';
  if (s === "low") return '<span class="badge low">Low stock</span>';
  return '<span class="badge ok">In stock</span>';
}

function niceDateTime(isoText) {
  return new Date(isoText).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

// Small message at the bottom of the screen
function toast(message, isError) {
  const box = $("toast");
  box.textContent = message;
  box.className = "toast" + (isError ? " error" : "");
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    box.hidden = true;
  }, 2800);
}

// "Nothing here yet" message
function emptyMessage(title, text, buttonHtml) {
  return '<div class="empty"><strong>' + title + "</strong>" + text + (buttonHtml || "") + "</div>";
}

// The yellow bar at the top (damaged data or blocked storage)
function updateNotice() {
  const box = $("data-notice");
  if (!box) return;

  let message = "";
  if (!storageWorks) {
    message = "Your browser is blocking saved data (for example in a private window). " +
              "The app works, but nothing will be kept after you refresh or close this page.";
  } else if (loadProblems > 0) {
    message = loadProblems + (loadProblems === 1 ? " damaged record was" : " damaged records were") +
              " skipped while loading saved data. Damaged records are removed the next time you save a change.";
  }
  box.textContent = message;
  box.hidden = message === "";
}

// Our own confirmation panel (replaces the browser's confirm box)
function askConfirm(title, text, okLabel, onYes, isDanger) {
  $("confirm-title").textContent = title;
  $("confirm-text").textContent = text;
  const okButton = $("confirm-ok");
  okButton.textContent = okLabel;
  okButton.className = "btn " + (isDanger ? "danger-fill" : "primary");
  confirmCallback = onYes;
  $("confirm-modal").hidden = false;
  $("confirm-cancel").focus();
}

function closeConfirm() {
  $("confirm-modal").hidden = true;
  confirmCallback = null;
}

/* ---------------------------------------------------------
   5. PAGE SWITCHING
   --------------------------------------------------------- */
function currentPageName() {
  const page = document.querySelector(".page.active");
  return page ? page.id.replace("page-", "") : "dashboard";
}

// Lower cart lines if stock changed, and remove lines for deleted products
function fixCartAfterStockChange() {
  const fixed = [];
  cart.forEach(function (line) {
    const p = findIn(products, line.id);
    if (!p || p.quantity === 0) return;
    if (line.qty > p.quantity) line.qty = p.quantity;
    fixed.push(line);
  });
  cart = fixed;
}

function showPage(name) {
  // always show the newest saved data
  reloadFromStorage();
  fixCartAfterStockChange();

  document.querySelectorAll(".page").forEach(function (page) {
    page.classList.remove("active");
  });
  document.querySelectorAll(".menu-btn").forEach(function (btn) {
    btn.classList.toggle("active", btn.dataset.page === name);
  });
  $("page-" + name).classList.add("active");

  if (name === "dashboard") renderDashboard();
  if (name === "products") renderProducts();
  if (name === "sale") renderSalePage();
  if (name === "history") renderHistory();
}

/* ---------------------------------------------------------
   6. DASHBOARD
   --------------------------------------------------------- */
function renderDashboard() {
  let revenue = 0;
  sales.forEach(function (s) { revenue += s.total; });

  const lowList = products.filter(function (p) {
    return p.quantity <= p.minStock;
  });

  let costValue = 0;
  products.forEach(function (p) { costValue += p.purchasePrice * p.quantity; });

  $("stat-products").textContent = products.length;
  $("stat-revenue").textContent = money(revenue);
  $("stat-orders").textContent = sales.length;
  $("stat-low").textContent = lowList.length;
  $("stat-cost").textContent = money(costValue);

  // top selling product
  const top = topSellingProduct(sales, products);
  if (top) {
    $("top-product").innerHTML =
      '<p class="top-name">' + esc(top.name) + "</p>" +
      '<p class="muted">' + top.units + (top.units === 1 ? " unit sold" : " units sold") + "</p>";
  } else {
    $("top-product").innerHTML = '<p class="muted">No sales yet. Complete a sale to see your best seller here.</p>';
  }

  // low stock list
  if (lowList.length === 0) {
    $("low-stock-list").innerHTML = '<p class="muted">All products have enough stock.</p>';
  } else {
    let html = "";
    lowList.forEach(function (p) {
      html +=
        '<div class="list-row"><span><strong>' + esc(p.name) + "</strong> (" + esc(p.id) + ")</span>" +
        "<span>" + p.quantity + " left (min " + p.minStock + ") " + statusBadge(p) + "</span></div>";
    });
    $("low-stock-list").innerHTML = html;
  }
}

/* ---------------------------------------------------------
   7. PRODUCTS
   --------------------------------------------------------- */

// Fill the category drop-down and the category suggestions in the form
function refreshCategories() {
  const cats = [];
  products.forEach(function (p) {
    if (cats.indexOf(p.category) === -1) cats.push(p.category);
  });
  cats.sort();

  const select = $("product-category");
  const current = select.value;
  let html = '<option value="">All categories</option>';
  cats.forEach(function (c) {
    html += '<option value="' + esc(c) + '">' + esc(c) + "</option>";
  });
  select.innerHTML = html;
  select.value = cats.indexOf(current) === -1 ? "" : current;

  let list = "";
  cats.forEach(function (c) { list += '<option value="' + esc(c) + '">'; });
  $("category-list").innerHTML = list;
}

// Apply search + category filter + sorting
function getVisibleProducts() {
  const search = $("product-search").value.trim().toLowerCase();
  const category = $("product-category").value;
  const sortBy = $("product-sort").value;

  const list = products.filter(function (p) {
    const matchSearch = p.name.toLowerCase().indexOf(search) !== -1 ||
                        p.id.toLowerCase().indexOf(search) !== -1;
    const matchCategory = category === "" || p.category === category;
    return matchSearch && matchCategory;
  });

  list.sort(function (a, b) {
    if (sortBy === "price") return a.sellingPrice - b.sellingPrice;
    if (sortBy === "quantity") return a.quantity - b.quantity;
    return a.name.localeCompare(b.name);
  });
  return list;
}

function renderProducts() {
  refreshCategories();
  const list = getVisibleProducts();
  let html = "";

  // data-label is the small title shown on phones (table becomes cards)
  list.forEach(function (p) {
    const rowClass = stockStatus(p) === "out" ? ' class="row-out"' : "";
    html +=
      "<tr" + rowClass + ">" +
      '<td data-label="ID">' + esc(p.id) + "</td>" +
      '<td data-label="Name"><strong>' + esc(p.name) + "</strong></td>" +
      '<td data-label="Category">' + esc(p.category) + "</td>" +
      '<td class="num" data-label="Purchase price">' + money(p.purchasePrice) + "</td>" +
      '<td class="num" data-label="Selling price">' + money(p.sellingPrice) + "</td>" +
      '<td class="num" data-label="Quantity">' + p.quantity + "</td>" +
      '<td class="num" data-label="Min stock">' + p.minStock + "</td>" +
      '<td data-label="Status">' + statusBadge(p) + "</td>" +
      '<td class="actions">' +
        '<button class="btn ghost small" data-edit="' + esc(p.id) + '">Edit</button>' +
        '<button class="btn danger small" data-delete="' + esc(p.id) + '">Delete</button>' +
      "</td></tr>";
  });
  $("product-table").innerHTML = html;

  if (products.length === 0) {
    $("product-empty").innerHTML = emptyMessage(
      "No products yet",
      "Add your first product to start tracking stock.",
      '<br><button class="btn primary" id="btn-sample">Add 5 sample products</button>'
    );
  } else if (list.length === 0) {
    $("product-empty").innerHTML = emptyMessage("No match", "Try a different search or category.");
  } else {
    $("product-empty").innerHTML = "";
  }
}

// ----- Add / edit window -----
function openProductForm(id) {
  editingId = id;
  $("form-error").textContent = "";
  $("form-warning").textContent = "";

  if (id) {
    const p = findIn(products, id);
    if (!p) return;
    $("modal-title").textContent = "Edit product";
    $("f-id").value = p.id;
    $("f-id").disabled = true; // ID cannot change when editing
    $("f-name").value = p.name;
    $("f-category").value = p.category;
    $("f-purchase").value = p.purchasePrice;
    $("f-selling").value = p.sellingPrice;
    $("f-quantity").value = p.quantity;
    $("f-min").value = p.minStock;
  } else {
    $("modal-title").textContent = "Add product";
    $("f-id").disabled = false;
    ["f-id", "f-name", "f-category", "f-purchase", "f-selling", "f-quantity", "f-min"].forEach(function (f) {
      $(f).value = "";
    });
  }

  updatePriceWarning();
  $("product-modal").hidden = false;
  $(id ? "f-name" : "f-id").focus();
}

function closeProductForm() {
  $("product-modal").hidden = true;
}

// Read the form into one object (raw text, trimmed)
function readProductForm() {
  return {
    id: $("f-id").value.trim(),
    name: $("f-name").value.trim(),
    category: $("f-category").value.trim(),
    purchase: $("f-purchase").value.trim(),
    selling: $("f-selling").value.trim(),
    quantity: $("f-quantity").value.trim(),
    min: $("f-min").value.trim()
  };
}

// Yellow heads-up if the shop would lose money on this product
function updatePriceWarning() {
  const purchase = Number($("f-purchase").value);
  const selling = Number($("f-selling").value);
  const bad = $("f-purchase").value !== "" && $("f-selling").value !== "" &&
              purchase > 0 && selling > 0 && purchase > selling;
  $("form-warning").textContent = bad
    ? "Warning: the selling price is lower than the purchase price, so you will lose money on every sale. You can still save."
    : "";
}

function saveProductForm() {
  const values = readProductForm();
  const wasEditing = editingId !== null;

  // changeData loads the newest data first, so duplicate-ID checks
  // and edits are always done on up-to-date products.
  const error = changeData(function () {
    const problem = validateProduct(values, products, editingId);
    if (problem) return problem;

    const data = {
      id: values.id,
      name: values.name,
      category: values.category,
      purchasePrice: Number(values.purchase),
      sellingPrice: Number(values.selling),
      quantity: Number(values.quantity),
      minStock: Number(values.min)
    };

    if (editingId === null) {
      products.push(data);
    } else {
      const old = findIn(products, editingId);
      if (!old) return "This product was deleted in another tab. Close this window and check the list.";
      products[products.indexOf(old)] = data;
    }
    return "";
  });

  if (error) {
    $("form-error").textContent = error;
    return;
  }

  fixCartAfterStockChange(); // keep the cart valid if stock was edited
  closeProductForm();
  renderProducts();
  toast(wasEditing ? "Product updated" : "Product added");
}

function deleteProduct(id) {
  const p = findIn(products, id);
  if (!p) return;

  askConfirm(
    "Delete product?",
    '"' + p.name + '" will be removed from your inventory. Past sales keep their records.',
    "Delete",
    function () {
      const error = changeData(function () {
        if (!findIn(products, id)) return "This product was already deleted in another tab.";
        products = products.filter(function (x) { return x.id !== id; });
        return "";
      });
      if (error) {
        renderProducts();
        toast(error, true);
        return;
      }
      cart = cart.filter(function (line) { return line.id !== id; });
      renderProducts();
      toast("Product deleted");
    },
    true
  );
}

function addSampleProducts() {
  const samples = [
    { id: "PRD-001", name: "Wireless Mouse", category: "Electronics", purchasePrice: 1200, sellingPrice: 1800, quantity: 25, minStock: 5 },
    { id: "PRD-002", name: "USB Keyboard", category: "Electronics", purchasePrice: 1500, sellingPrice: 2300, quantity: 12, minStock: 5 },
    { id: "PRD-003", name: "A4 Paper Pack", category: "Stationery", purchasePrice: 900, sellingPrice: 1200, quantity: 4, minStock: 10 },
    { id: "PRD-004", name: "Gel Pen Box", category: "Stationery", purchasePrice: 250, sellingPrice: 400, quantity: 40, minStock: 10 },
    { id: "PRD-005", name: "Phone Charger", category: "Electronics", purchasePrice: 700, sellingPrice: 1100, quantity: 0, minStock: 5 }
  ];

  const error = changeData(function () {
    samples.forEach(function (s) {
      if (!findIn(products, s.id)) products.push(s);
    });
    return "";
  });

  renderProducts();
  if (error) toast(error, true);
  else toast("Sample products added");
}

/* ---------------------------------------------------------
   8. NEW SALE (cart + checkout)
   --------------------------------------------------------- */

// How many of this product are already in the cart?
function cartQty(id) {
  for (let i = 0; i < cart.length; i++) {
    if (cart[i].id === id) return cart[i].qty;
  }
  return 0;
}

function renderSalePage() {
  renderSaleProducts();
  renderCart();
}

function renderSaleProducts() {
  const search = $("sale-search").value.trim().toLowerCase();
  const list = products.filter(function (p) {
    return p.name.toLowerCase().indexOf(search) !== -1 ||
           p.id.toLowerCase().indexOf(search) !== -1;
  });
  list.sort(function (a, b) { return a.name.localeCompare(b.name); });

  if (products.length === 0) {
    $("sale-products").innerHTML = emptyMessage("No products to sell", "Go to Products and add some first.");
    return;
  }
  if (list.length === 0) {
    $("sale-products").innerHTML = emptyMessage("No match", "Try a different search.");
    return;
  }

  let html = "";
  list.forEach(function (p) {
    const inCart = cartQty(p.id);
    const disabled = p.quantity === 0 || inCart >= p.quantity;
    const label = p.quantity === 0 ? "Out of stock" : (inCart >= p.quantity ? "Max in cart" : "Add");
    html +=
      '<div class="pick-row">' +
        '<div class="pick-info">' +
          '<div class="pick-name">' + esc(p.name) + "</div>" +
          '<div class="pick-meta">' + esc(p.id) + " · " + money(p.sellingPrice) + " · " + p.quantity + " in stock " + statusBadge(p) + "</div>" +
        "</div>" +
        '<button class="btn primary small" data-add="' + esc(p.id) + '"' + (disabled ? " disabled" : "") + ">" + label + "</button>" +
      "</div>";
  });
  $("sale-products").innerHTML = html;
}

function renderCart() {
  let html = "";

  if (cart.length === 0) {
    html = emptyMessage("Cart is empty", "Add products from the list.");
  } else {
    cart.forEach(function (line) {
      const p = findIn(products, line.id);
      if (!p) return;
      html +=
        '<div class="cart-row">' +
          '<div class="cart-top"><span>' + esc(p.name) + "</span><span>" + money(p.sellingPrice * line.qty) + "</span></div>" +
          '<div class="cart-controls">' +
            '<button class="btn ghost small" data-minus="' + esc(p.id) + '" aria-label="Decrease quantity">−</button>' +
            '<span class="qty">' + line.qty + "</span>" +
            '<button class="btn ghost small" data-plus="' + esc(p.id) + '" aria-label="Increase quantity"' + (line.qty >= p.quantity ? " disabled" : "") + ">+</button>" +
            '<button class="btn danger small" data-remove="' + esc(p.id) + '">Remove</button>' +
            '<span class="unit">' + money(p.sellingPrice) + " each</span>" +
          "</div>" +
        "</div>";
    });
  }
  $("cart-items").innerHTML = html;

  const t = calculateTotals(cart, products);
  $("cart-subtotal").textContent = money(t.subtotal);
  $("cart-discount").textContent = "− " + money(t.discount);
  $("cart-tax").textContent = money(t.tax);
  $("cart-total").textContent = money(t.total);

  $("btn-checkout").disabled = cart.length === 0;
  $("btn-clear-cart").disabled = cart.length === 0;
}

function addToCart(id) {
  const p = findIn(products, id);
  if (!p) return;
  let line = null;
  cart.forEach(function (c) { if (c.id === id) line = c; });

  if (line) {
    if (line.qty >= p.quantity) {
      toast("Only " + p.quantity + " in stock", true);
      return;
    }
    line.qty += 1;
  } else {
    if (p.quantity < 1) {
      toast("This product is out of stock", true);
      return;
    }
    cart.push({ id: id, qty: 1 });
  }
  renderSalePage();
}

function changeCartQty(id, change) {
  const p = findIn(products, id);
  cart.forEach(function (line) {
    if (line.id !== id) return;
    const newQty = line.qty + change;
    if (change > 0 && p && newQty > p.quantity) {
      toast("Only " + p.quantity + " in stock", true);
      return;
    }
    line.qty = newQty;
  });
  cart = cart.filter(function (line) { return line.qty > 0; });
  renderSalePage();
}

function removeFromCart(id) {
  cart = cart.filter(function (line) { return line.id !== id; });
  renderSalePage();
}

// Step 1: check everything with the NEWEST data, then ask "Are you sure?"
function checkout() {
  // newest data first (another tab may have sold some of this stock)
  reloadFromStorage();
  const before = JSON.stringify(cart);
  fixCartAfterStockChange();

  const cartChanged = JSON.stringify(cart) !== before;

  // no empty orders
  if (cart.length === 0) {
    renderSalePage();
    if (cartChanged) toast("Stock changed in another tab. The items in your cart are no longer available.", true);
    else toast("Cart is empty. Add a product first.", true);
    return;
  }
  // stock changed behind our back: show the corrected cart and let the user decide again
  if (cartChanged) {
    renderSalePage();
    toast("Stock changed in another tab. Your cart was updated, please check it.", true);
    return;
  }

  const shownTotal = calculateTotals(cart, products).total;
  const itemCount = cart.reduce(function (sum, line) { return sum + line.qty; }, 0);

  askConfirm(
    "Complete this sale?",
    itemCount + (itemCount === 1 ? " item" : " items") + ", grand total " + money(shownTotal) + ".",
    "Complete sale",
    function () { finishCheckout(shownTotal); },
    false
  );
}

// Step 2: the real checkout. Everything is re-checked and saved in one safe step.
function finishCheckout(expectedTotal) {
  let newSale = null;

  const error = changeData(function () {
    if (cart.length === 0) return "Cart is empty. Add a product first.";

    // check stock for EVERY item before changing anything
    for (let i = 0; i < cart.length; i++) {
      const p = findIn(products, cart[i].id);
      if (!p) return "A product in the cart no longer exists.";
      if (cart[i].qty < 1 || cart[i].qty > p.quantity) return "Not enough stock for " + p.name + ".";
    }

    const totals = calculateTotals(cart, products);
    if (totals.total !== expectedTotal) return "Prices changed in another tab. Please check the cart and try again.";

    const items = [];
    cart.forEach(function (line) {
      const product = findIn(products, line.id);
      items.push({
        id: product.id,
        name: product.name,
        price: product.sellingPrice,
        qty: line.qty,
        lineTotal: round2(product.sellingPrice * line.qty)
      });
      product.quantity -= line.qty; // deduct stock
    });

    newSale = {
      id: nextSaleId(sales),
      time: new Date().toISOString(),
      items: items,
      subtotal: totals.subtotal,
      discount: totals.discount,
      tax: totals.tax,
      total: totals.total
    };
    sales.push(newSale);
    return "";
  });

  if (error) {
    fixCartAfterStockChange();
    renderSalePage();
    toast(error, true);
    return;
  }

  cart = [];
  renderSalePage();
  toast("Sale " + newSale.id + " completed: " + money(newSale.total));
}

function clearCart() {
  if (cart.length === 0) return;
  askConfirm("Clear the cart?", "All items will be removed from this sale.", "Clear cart", function () {
    cart = [];
    renderSalePage();
  }, true);
}

/* ---------------------------------------------------------
   9. SALES HISTORY
   --------------------------------------------------------- */
function renderHistory() {
  const search = $("history-search").value.trim().toLowerCase();
  const date = $("history-date").value; // "" or YYYY-MM-DD

  const list = sales.filter(function (s) {
    const matchId = s.id.toLowerCase().indexOf(search) !== -1;
    const matchDate = date === "" || dateOnly(s.time) === date;
    return matchId && matchDate;
  });

  // newest first
  list.sort(function (a, b) { return new Date(b.time) - new Date(a.time); });

  let html = "";
  list.forEach(function (s) {
    let itemsHtml = "";
    s.items.forEach(function (item) {
      itemsHtml += "<div>" + esc(item.name) + " × " + item.qty + "</div>";
    });
    html +=
      "<tr>" +
      '<td data-label="Sale ID"><strong>' + esc(s.id) + "</strong></td>" +
      '<td data-label="Date & time">' + niceDateTime(s.time) + "</td>" +
      '<td class="items-cell" data-label="Items"><div class="items-list">' + itemsHtml + "</div></td>" +
      '<td class="num" data-label="Final amount"><strong>' + money(s.total) + "</strong></td>" +
      "</tr>";
  });
  $("history-table").innerHTML = html;

  if (sales.length === 0) {
    $("history-empty").innerHTML = emptyMessage("No sales yet", "Completed sales will appear here.");
  } else if (list.length === 0) {
    $("history-empty").innerHTML = emptyMessage("No sales found", "Try another sale ID or date.");
  } else {
    $("history-empty").innerHTML = "";
  }
}

/* ---------------------------------------------------------
   10. START THE APP
   --------------------------------------------------------- */
function setupButtons() {
  // menu
  document.querySelectorAll(".menu-btn").forEach(function (btn) {
    btn.addEventListener("click", function () { showPage(btn.dataset.page); });
  });

  // products page
  $("btn-add-product").addEventListener("click", function () { openProductForm(null); });
  $("product-search").addEventListener("input", renderProducts);
  $("product-category").addEventListener("change", renderProducts);
  $("product-sort").addEventListener("change", renderProducts);

  // clicks inside the product area (edit, delete, sample button)
  $("page-products").addEventListener("click", function (e) {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.edit) openProductForm(t.dataset.edit);
    if (t.dataset.delete) deleteProduct(t.dataset.delete);
    if (t.id === "btn-sample") addSampleProducts();
  });

  // add / edit window
  $("btn-save").addEventListener("click", saveProductForm);
  $("btn-cancel").addEventListener("click", closeProductForm);
  $("f-purchase").addEventListener("input", updatePriceWarning);
  $("f-selling").addEventListener("input", updatePriceWarning);
  $("product-modal").addEventListener("click", function (e) {
    if (e.target === $("product-modal")) closeProductForm(); // click outside
  });
  $("product-modal").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.tagName === "INPUT") saveProductForm();
  });

  // confirmation panel
  $("confirm-cancel").addEventListener("click", closeConfirm);
  $("confirm-ok").addEventListener("click", function () {
    const action = confirmCallback;
    closeConfirm();
    if (action) action();
  });
  $("confirm-modal").addEventListener("click", function (e) {
    if (e.target === $("confirm-modal")) closeConfirm();
  });

  // Escape closes whichever window is open (confirm panel first)
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!$("confirm-modal").hidden) closeConfirm();
    else if (!$("product-modal").hidden) closeProductForm();
  });

  // sale page
  $("sale-search").addEventListener("input", renderSaleProducts);
  $("page-sale").addEventListener("click", function (e) {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.add) addToCart(t.dataset.add);
    if (t.dataset.plus) changeCartQty(t.dataset.plus, 1);
    if (t.dataset.minus) changeCartQty(t.dataset.minus, -1);
    if (t.dataset.remove) removeFromCart(t.dataset.remove);
  });
  $("btn-checkout").addEventListener("click", checkout);
  $("btn-clear-cart").addEventListener("click", clearCart);

  // history page
  $("history-search").addEventListener("input", renderHistory);
  $("history-date").addEventListener("change", renderHistory);
  $("btn-clear-filters").addEventListener("click", function () {
    $("history-search").value = "";
    $("history-date").value = "";
    renderHistory();
  });

  // another tab changed the data
  window.addEventListener("storage", onStorageChange);
}

function startApp() {
  checkStorageWorks();
  reloadFromStorage();
  updateNotice();
  setupButtons();
  showPage("dashboard");
}

// Start only when the real page is open (tests.html loads this file without the page)
if (document.getElementById("page-dashboard")) {
  startApp();
}
