# System Pagla

A browser-based inventory and sales management app for a small shop. Built with plain HTML, CSS and vanilla JavaScript. No framework, no backend, no installation.

## How to run

1. Keep these files together in one folder: `index.html`, `style.css`, `script.js`.
2. Double-click `index.html` (or right-click, then Open with, then your browser).
3. That is all. Works in Chrome, Edge, Firefox and Safari, on desktop and mobile.

### Put it online (optional, free): GitHub Pages

Because this is a static site, it can be hosted for free:

1. Put the project files in the **root** of your GitHub repository (so `index.html` is not inside a sub-folder).
2. Open the repository, then **Settings**, then **Pages**.
3. Under "Build and deployment" choose **Deploy from a branch**, pick the `main` branch and the `/ (root)` folder, then **Save**.
4. After a minute the site is live at `https://<your-username>.github.io/<repository-name>/`.

## What it does

- **Dashboard:** total products, total revenue, completed orders, low-stock count, top-selling product, inventory cost value, and a list of products that need restocking.
- **Products:** add, edit and delete (with a confirmation panel). Search by name or ID, filter by category, sort by name, selling price or quantity. On phones the table becomes easy-to-read cards.
- **New Sale:** add products to a cart, change quantities, remove items. Quantities can never go above available stock. 10% discount when the subtotal is PKR 10,000 or more, then 5% tax on the discounted amount. Discount, tax and grand total are shown separately.
- **Sales History:** every completed sale with ID, date and time, items, quantities and final amount. Search by sale ID and filter by date.
- **Saving:** products and sales are stored in the browser's `localStorage`, so they are still there after a refresh or reopening the page in the same browser.

## Suggested test flow

1. Open the Dashboard (all zeros at first).
2. Go to Products and click **Add 5 sample products** (or add your own).
3. Go to New Sale, add several products, check the totals, click **Complete checkout** and confirm.
4. Go back to Products: stock has gone down.
5. Open Sales History and find the order.
6. Refresh the browser: everything is still there.

## Calculation example

Subtotal PKR 12,000 gives discount PKR 1,200, so the amount after discount is PKR 10,800. Tax is 5% of 10,800 = PKR 540. Grand total is PKR 11,340.

## Using the app in two tabs

The shop can safely keep the app open in more than one tab of the same browser:

- Before every change (save product, delete, checkout) the app re-reads the newest saved data, applies the change, then saves. One tab can never overwrite what another tab did.
- When one tab saves, the other tab refreshes itself and shows a short message.
- Sale IDs are always taken from the newest data, so two tabs cannot create the same ID.
- If stock or prices were changed in another tab while you were checking out, the checkout is stopped and you are asked to check the cart again.

## Tests

Open `tests.html` in your browser. It runs automatic tests for the calculation and checking functions (totals and discount, sale IDs, cleaning of saved data, form validation, top-selling product, money format) and shows a green "ALL PASSED" bar, or the failing test in red.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page structure (4 sections, add/edit window, confirmation panel) |
| `style.css` | All styling, including the mobile layout |
| `script.js` | All logic, split into numbered sections with comments |
| `tests.html` | Automatic tests, open it in a browser |
| `README.md` | This file |

## Assumptions

- Product IDs are not case-sensitive for duplicate checks (`prd-001` and `PRD-001` count as the same ID).
- A product's ID cannot be changed while editing (this keeps IDs unique).
- Limits: ID up to 20 characters, name up to 60, category up to 30, prices up to PKR 100,000,000, quantities up to 1,000,000.
- If the purchase price is higher than the selling price, the form shows a warning but still lets you save (a shop may sell at a loss on purpose, for example in a clearance sale).
- "Low stock" means quantity is at or below the minimum threshold. Out-of-stock products (quantity 0) are also counted in the low-stock number on the Dashboard, and are shown with their own "Out of stock" badge.
- Each sale stores a copy of the product name and price at the time of sale, so history stays correct even if a product is later edited or deleted.
- The top-selling product is calculated from total units sold, grouped by product ID (so renaming a product keeps its history, and two products with the same name are not mixed up). The current product name is shown.
- Sale IDs look like `SALE-0001`, counting up from the highest existing one.
- Amounts are shown in PKR with 2 decimal places.

## Limitations

- Data lives only in the browser where it was entered. A different browser, device or private window will not see it. Clearing browser data removes it. In a private window or when the browser blocks storage, the app still works but shows a warning because nothing is kept after closing.
- No login, no multiple users, no refunds or returns.
- No export or backup feature.
- Damaged saved data is never allowed to crash the app. A damaged product is skipped. A damaged sale is skipped **completely** (never half of it), and a yellow notice at the top tells you how many records were skipped. They are removed from storage the next time you save a change.
- Two tabs saving at the exact same millisecond could in theory still collide, because the browser has no real database lock for `localStorage`. In normal shop use this will not happen.
