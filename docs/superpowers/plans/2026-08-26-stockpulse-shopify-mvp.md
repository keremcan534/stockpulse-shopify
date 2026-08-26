# StockPulse Shopify MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an embedded Shopify inventory dashboard that reports low stock, days of stock, dead stock, and deterministic reorder recommendations per variant.

**Architecture:** Start from Shopify's official React Router template, keep Shopify authentication and session storage intact, and add a server-only GraphQL repository plus a dependency-free metrics module. The authenticated index route loads normalized data and passes calculated rows to a focused dashboard component; the browser only searches and filters the already-loaded result.

**Tech Stack:** Node.js 20.19+, TypeScript 5, React 18, React Router 7, Shopify App Bridge, Polaris web components, Admin GraphQL API, Prisma session storage, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-26-stockpulse-shopify-mvp-design.md`

## Global Constraints

- Keep the app embedded in Shopify Admin and use the official React Router template.
- Request only `read_products`, `read_inventory`, and `read_orders`.
- Never mutate Shopify products, orders, or inventory.
- Use a 30-day sales window, a 60-day dead-stock window, a 14-day low-stock threshold, and a 30-day reorder target.
- Aggregate tracked inventory across Shopify's reported variant inventory quantity and paginate every queried connection.
- Treat unavailable sales history as partial data; never fabricate sales-derived metrics.
- Do not add billing, notifications, purchase orders, configurable thresholds, exports, background jobs, or multi-store aggregation.

## File Structure

- `package.json`: Shopify scripts plus Vitest test scripts and test dependencies.
- `vitest.config.ts`: Node and jsdom test projects.
- `app/features/inventory/inventory.types.ts`: normalized records and dashboard view types.
- `app/features/inventory/inventory-metrics.ts`: pure calculations, status assignment, summary, filter, and sort behavior.
- `app/features/inventory/inventory-metrics.test.ts`: metric boundary tests.
- `app/features/inventory/shopify-inventory.server.ts`: read-only GraphQL documents, pagination, normalization, and partial-data handling.
- `app/features/inventory/shopify-inventory.server.test.ts`: repository contract tests with deterministic GraphQL fixtures.
- `app/features/inventory/inventory-dashboard.tsx`: dashboard presentation and browser-side controls.
- `app/features/inventory/inventory-dashboard.test.tsx`: component states, controls, and summary tests.
- `app/routes/app._index.tsx`: authenticated loader and route error boundary.
- `shopify.app.toml`: read-only scopes and current template configuration.
- `README.md`: setup, metric definitions, required scopes, and verification commands.

---

### Task 1: Scaffold the Official App and Establish the Test Harness

**Files:**
- Create from Shopify CLI: official React Router template files
- Modify: `package.json`
- Create: `vitest.config.ts`
- Modify: `shopify.app.toml`
- Preserve: `docs/superpowers/specs/2026-08-26-stockpulse-shopify-mvp-design.md`
- Preserve: `docs/superpowers/plans/2026-08-26-stockpulse-shopify-mvp.md`

**Interfaces:**
- Consumes: the empty repository and Shopify's official React Router template.
- Produces: working `npm run build`, `npm run typecheck`, `npm run lint`, and `npm test` commands.

- [ ] **Step 1: Generate the official template without creating an app record**

Run Shopify CLI's React Router initializer into a temporary child directory, then merge the generated tracked files into the repository while preserving `docs/` and `.git/`. If the CLI requires browser authentication merely to download the template, use the already-inspected official template checkout as the exact fallback source and record that choice in the commit.

- [ ] **Step 2: Install the generated dependencies**

Run: `npm install`

Expected: a lockfile is created and Prisma's generated client setup completes without an app-store login.

- [ ] **Step 3: Add the test harness**

Install `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, and `@testing-library/user-event` as development dependencies. Add these scripts:

```json
{
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Create `vitest.config.ts` with a Node default and jsdom for `*.test.tsx`:

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    environmentMatchGlobs: [["**/*.test.tsx", "jsdom"]],
    globals: true,
  },
});
```

- [ ] **Step 4: Configure read-only Shopify scopes**

Set `scopes = "read_products,read_inventory,read_orders"` in `shopify.app.toml`. Remove sample write scopes without changing the template's webhook subscriptions.

- [ ] **Step 5: Verify the untouched scaffold**

Run: `npm test && npm run typecheck && npm run lint && npm run build`

Expected: zero tests initially, then successful typecheck, lint, and production build.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "chore: scaffold Shopify React Router app"
```

---

### Task 2: Implement Inventory Metrics with TDD

**Files:**
- Create: `app/features/inventory/inventory.types.ts`
- Create: `app/features/inventory/inventory-metrics.test.ts`
- Create: `app/features/inventory/inventory-metrics.ts`

**Interfaces:**
- Consumes: normalized `CatalogVariant` and `VariantSales` records.
- Produces: `calculateInventoryRows(input)`, `summarizeInventory(rows)`, `filterInventoryRows(rows, filters)`, and `sortInventoryRows(rows)`.

Define these public types exactly:

```ts
export type InventoryStatus =
  | "not-tracked"
  | "out-of-stock"
  | "dead-stock"
  | "low-stock"
  | "healthy";

export interface CatalogVariant {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  tracked: boolean;
  availableInventory: number;
}

export interface VariantSales {
  variantId: string;
  units30Days: number;
  units60Days: number;
}

export interface InventoryRow extends CatalogVariant {
  units30Days: number | null;
  units60Days: number | null;
  averageDailySales: number | null;
  daysOfStock: number | null;
  reorderQuantity: number | null;
  status: InventoryStatus;
}

export interface InventorySummary {
  tracked: number;
  lowOrOut: number;
  dead: number;
}
```

- [ ] **Step 1: Write failing metric tests**

Use literal fixtures and cover the expected break in each test:

```ts
import { describe, expect, it } from "vitest";
import {
  calculateInventoryRows,
  filterInventoryRows,
  sortInventoryRows,
  summarizeInventory,
} from "./inventory-metrics";
import type { CatalogVariant, InventoryStatus } from "./inventory.types";

const catalog = (availableInventory: number, tracked = true): CatalogVariant => ({
  variantId: "gid://shopify/ProductVariant/1",
  productTitle: "T-shirt",
  variantTitle: "Blue / M",
  sku: "BLUE-M",
  tracked,
  availableInventory,
});

it.each([
  { inventory: 15, units30: 30, units60: 30, status: "healthy", days: 15, reorder: 15 },
  { inventory: 14, units30: 30, units60: 30, status: "low-stock", days: 14, reorder: 16 },
  { inventory: 31, units30: 30, units60: 30, status: "healthy", days: 31, reorder: 0 },
  { inventory: 0, units30: 0, units60: 0, status: "out-of-stock", days: 0, reorder: 0 },
  { inventory: 8, units30: 0, units60: 0, status: "dead-stock", days: null, reorder: 0 },
])("calculates the specified inventory boundary", expected => {
  const [row] = calculateInventoryRows(
    [catalog(expected.inventory)],
    [{ variantId: catalog(0).variantId, units30Days: expected.units30, units60Days: expected.units60 }],
    true,
  );
  expect(row.status).toBe(expected.status);
  expect(row.daysOfStock).toBe(expected.days);
  expect(row.reorderQuantity).toBe(expected.reorder);
});

it("marks sales-derived values unavailable when sales history failed", () => {
  const [row] = calculateInventoryRows([catalog(9)], [], false);
  expect(row).toMatchObject({
    units30Days: null,
    units60Days: null,
    averageDailySales: null,
    daysOfStock: null,
    reorderQuantity: null,
    status: "healthy",
  });
});

it("marks untracked variants without including them in risk counts", () => {
  const [row] = calculateInventoryRows([catalog(0, false)], [], true);
  expect(row.status).toBe("not-tracked");
  expect(summarizeInventory([row])).toEqual({ tracked: 0, lowOrOut: 0, dead: 0 });
});

it("rounds a fractional reorder recommendation up to a whole unit", () => {
  const [row] = calculateInventoryRows(
    [catalog(0)],
    [{ variantId: catalog(0).variantId, units30Days: 1, units60Days: 1 }],
    true,
  );
  expect(row.reorderQuantity).toBe(1);
});

it("sorts risk statuses before healthy stock and then by product title", () => {
  const rows = ([
    { variantId: "healthy", productTitle: "A", status: "healthy", daysOfStock: 40 },
    { variantId: "dead", productTitle: "C", status: "dead-stock", daysOfStock: null },
    { variantId: "low", productTitle: "B", status: "low-stock", daysOfStock: 4 },
    { variantId: "out", productTitle: "D", status: "out-of-stock", daysOfStock: 0 },
  ] as unknown) as ReturnType<typeof calculateInventoryRows>;
  expect(sortInventoryRows(rows).map(row => row.variantId)).toEqual(["out", "low", "dead", "healthy"]);
});

it("filters by status and case-insensitive product, variant, or SKU text", () => {
  const [row] = calculateInventoryRows(
    [catalog(8)],
    [{ variantId: catalog(8).variantId, units30Days: 0, units60Days: 0 }],
    true,
  );
  expect(filterInventoryRows([row], { query: "blue-m", status: "dead-stock" }).map(item => item.variantId))
    .toEqual(["gid://shopify/ProductVariant/1"]);
  expect(filterInventoryRows([row], { query: "missing", status: "all" })).toEqual([]);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- app/features/inventory/inventory-metrics.test.ts`

Expected: FAIL because `inventory-metrics.ts` does not exist.

- [ ] **Step 3: Implement the minimal calculation module**

Implement `calculateInventoryRows(catalog: CatalogVariant[], sales: VariantSales[], salesAvailable: boolean): InventoryRow[]`, `summarizeInventory(rows: InventoryRow[]): InventorySummary`, `filterInventoryRows(rows: InventoryRow[], filters: { query: string; status: InventoryStatus | "all" }): InventoryRow[]`, and `sortInventoryRows(rows: InventoryRow[]): InventoryRow[]`. Use constants `SALES_WINDOW_DAYS = 30`, `LOW_STOCK_DAYS = 14`, and `REORDER_TARGET_DAYS = 30`. When `salesAvailable` is false, set sales-derived values and `reorderQuantity` to `null`, retain out-of-stock/not-tracked classification, and otherwise use `healthy` because demand risk is unknown. Apply the spec's status precedence exactly.

- [ ] **Step 4: Run the focused and full tests**

Run: `npm test -- app/features/inventory/inventory-metrics.test.ts && npm test`

Expected: PASS with every metric boundary covered.

- [ ] **Step 5: Commit**

```bash
git add app/features/inventory
git commit -m "feat: calculate inventory health metrics"
```

---

### Task 3: Load and Normalize Shopify Inventory Data with TDD

**Files:**
- Create: `app/features/inventory/shopify-inventory.server.test.ts`
- Create: `app/features/inventory/shopify-inventory.server.ts`

**Interfaces:**
- Consumes: an authenticated GraphQL function with signature `(query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>` and a clock `now: Date`.
- Produces: `loadShopifyInventory(graphql, now): Promise<{ catalog: CatalogVariant[]; sales: VariantSales[]; salesAvailable: boolean; warning: string | null }>`.

- [ ] **Step 1: Write failing repository contract tests**

Create a deterministic response queue that returns real `Response` objects. Mirror Shopify response shapes for:

```ts
{
  data: {
    productVariants: {
      nodes: [{
        id: "gid://shopify/ProductVariant/1",
        title: "Blue / M",
        sku: "BLUE-M",
        inventoryQuantity: 12,
        inventoryItem: { tracked: true },
        product: { title: "T-shirt" }
      }],
      pageInfo: { hasNextPage: false, endCursor: null }
    }
  }
}
```

and orders with complete `id`, `cancelledAt`, `createdAt`, line-item `currentQuantity`, variant `id`, plus connection page info. Tests must prove:

- Product-variant pages are combined without truncation.
- Order pages and an order's additional line-item pages are combined.
- Cancelled orders and missing variant references are ignored.
- Quantities inside 30 days contribute to both windows; quantities from day 31 through day 60 contribute only to the 60-day window.
- A GraphQL `errors` array rejects that query even when HTTP status is 200.
- An order-history failure returns catalog data, `salesAvailable: false`, and a warning.
- A catalog failure rejects the whole load.

- [ ] **Step 2: Run the repository tests and verify RED**

Run: `npm test -- app/features/inventory/shopify-inventory.server.test.ts`

Expected: FAIL because the server repository module does not exist.

- [ ] **Step 3: Implement read-only paginated GraphQL loading**

Use a `productVariants(first: 100, after: $after)` query for catalog data and `orders(first: 50, after: $after, query: $query)` with `lineItems(first: 250)` for the 60-day history. When an order reports more line items, request `order(id: $id) { lineItems(first: 250, after: $after) }` until complete. Query dates use UTC ISO timestamps and never include mutations.

Validate `response.ok`, parsed JSON, GraphQL errors, and required connection objects. Aggregate units in `Map<string, { units30Days: number; units60Days: number }>` and return zero records only through metric joining, not fabricated sales nodes.

- [ ] **Step 4: Run focused and full tests**

Run: `npm test -- app/features/inventory/shopify-inventory.server.test.ts && npm test`

Expected: PASS, including pagination and partial-data tests.

- [ ] **Step 5: Commit**

```bash
git add app/features/inventory
git commit -m "feat: load Shopify inventory and sales data"
```

---

### Task 4: Build the Embedded Dashboard with TDD

**Files:**
- Create: `app/features/inventory/inventory-dashboard.test.tsx`
- Create: `app/features/inventory/inventory-dashboard.tsx`
- Modify: `app/routes/app._index.tsx`
- Modify: `app/routes/app.tsx`

**Interfaces:**
- Consumes: `{ rows: InventoryRow[]; summary: InventorySummary; warning: string | null; generatedAt: string }`.
- Produces: an accessible `InventoryDashboard` component and an authenticated route loader response.

- [ ] **Step 1: Write failing dashboard tests**

Render the real component with literal rows and assert user-visible behavior:

```ts
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { InventoryDashboard } from "./inventory-dashboard";
import type { InventoryRow } from "./inventory.types";

const rows: InventoryRow[] = [
  {
    variantId: "1",
    productTitle: "T-shirt",
    variantTitle: "Blue / M",
    sku: "BLUE-M",
    tracked: true,
    availableInventory: 4,
    units30Days: 30,
    units60Days: 45,
    averageDailySales: 1,
    daysOfStock: 4,
    reorderQuantity: 26,
    status: "low-stock",
  },
  {
    variantId: "2",
    productTitle: "Old cap",
    variantTitle: "Default",
    sku: "CAP-OLD",
    tracked: true,
    availableInventory: 8,
    units30Days: 0,
    units60Days: 0,
    averageDailySales: 0,
    daysOfStock: null,
    reorderQuantity: 0,
    status: "dead-stock",
  },
];

const renderDashboard = (overrides: Partial<React.ComponentProps<typeof InventoryDashboard>> = {}) =>
  render(<InventoryDashboard rows={rows} summary={{ tracked: 2, lowOrOut: 1, dead: 1 }} warning={null} generatedAt="2026-08-26T09:00:00.000Z" {...overrides} />);

it("shows tracked, low-stock, and dead-stock summary counts", () => {
  renderDashboard();
  expect(screen.getByText("2 tracked variants")).toBeInTheDocument();
  expect(screen.getByText("1 low or out of stock")).toBeInTheDocument();
  expect(screen.getByText("1 dead stock")).toBeInTheDocument();
});

it("renders inventory metrics and an em dash for unavailable days", () => {
  renderDashboard();
  expect(screen.getByText("BLUE-M")).toBeInTheDocument();
  expect(screen.getByText("26")).toBeInTheDocument();
  expect(screen.getByText("—")).toBeInTheDocument();
});

it("filters rows by case-insensitive search text", async () => {
  renderDashboard();
  await userEvent.type(screen.getByLabelText("Search inventory"), "cap-old");
  expect(screen.getByText("Old cap")).toBeInTheDocument();
  expect(screen.queryByText("T-shirt")).not.toBeInTheDocument();
});

it("filters rows by inventory status", async () => {
  renderDashboard();
  await userEvent.selectOptions(screen.getByLabelText("Inventory status"), "dead-stock");
  expect(screen.getByText("Old cap")).toBeInTheDocument();
  expect(screen.queryByText("T-shirt")).not.toBeInTheDocument();
});

it("distinguishes a store with no variants from filters with no matches", async () => {
  const { unmount } = renderDashboard({ rows: [], summary: { tracked: 0, lowOrOut: 0, dead: 0 } });
  expect(screen.getByText("No product variants found")).toBeInTheDocument();
  unmount();
  renderDashboard();
  await userEvent.type(screen.getByLabelText("Search inventory"), "missing");
  expect(screen.getByText("No inventory matches these filters")).toBeInTheDocument();
});

it("keeps partial inventory visible while showing the sales warning", () => {
  renderDashboard({ warning: "Sales history is temporarily unavailable." });
  expect(screen.getByText("Sales history is temporarily unavailable.")).toBeInTheDocument();
  expect(screen.getByText("T-shirt")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run component tests and verify RED**

Run: `npm test -- app/features/inventory/inventory-dashboard.test.tsx`

Expected: FAIL because the dashboard component does not exist.

- [ ] **Step 3: Implement the dashboard component**

Use Polaris web components and native controls where testable accessibility requires it. Include one page heading, explanatory text, three summary cards, a search input with label `Search inventory`, a status select with label `Inventory status`, and a table with the columns specified in the design. Add explicit text for initial empty state, no filter matches, sales warning, and generated timestamp. Status labels map to `Not tracked`, `Out of stock`, `Dead stock`, `Low stock`, and `Healthy`.

- [ ] **Step 4: Replace the sample route**

The loader must call `authenticate.admin(request)`, pass `admin.graphql` to `loadShopifyInventory`, calculate and sort rows, and return serializable data. Remove the sample product-creation action and all write behavior. Keep Shopify's `boundary.headers` and add a route `ErrorBoundary` that shows a retryable message without leaking API responses. Update app navigation to the single StockPulse dashboard destination.

- [ ] **Step 5: Run focused and full verification**

Run: `npm test -- app/features/inventory/inventory-dashboard.test.tsx && npm test && npm run typecheck && npm run lint && npm run build`

Expected: all dashboard tests pass and production checks complete without errors or warnings.

- [ ] **Step 6: Commit**

```bash
git add app
git commit -m "feat: add embedded inventory dashboard"
```

---

### Task 5: Document, Verify, and Smoke Test the MVP

**Files:**
- Modify: `README.md`
- Modify only if verification finds a defect: files from Tasks 1-4 plus the corresponding failing regression test.

**Interfaces:**
- Consumes: the completed embedded application.
- Produces: reproducible local setup instructions and final verification evidence.

- [ ] **Step 1: Replace template documentation**

Document prerequisites, `npm install`, Shopify CLI login/dev-store setup, `npm run dev`, required scopes, all metric formulas, partial-data behavior, and the commands `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. State explicitly that recommendations are advisory and the app has no Shopify write scopes.

- [ ] **Step 2: Run the complete automated verification suite**

Run: `npm test && npm run typecheck && npm run lint && npm run build`

Expected: all tests pass, type checking and linting report no errors, and the production build exits zero.

- [ ] **Step 3: Inspect the final change set**

Run: `git diff --check HEAD~4..HEAD`, `git status --short`, and inspect every changed file for sample mutation code, write scopes, placeholder text, secrets, and generated build output.

Expected: no whitespace errors, secrets, mutation operations, placeholder content, or untracked build artifacts.

- [ ] **Step 4: Run the embedded development-store smoke test when authentication is available**

Run: `npm run dev`

Expected: Shopify CLI links or creates the app record, requests only the three read scopes, opens the embedded dashboard, and the page reaches a data, empty, partial-data, or explicit retryable error state without console errors. If Shopify requires the merchant to choose an organization/store or approve installation, pause only for that browser interaction and resume automatically afterward.

- [ ] **Step 5: Commit documentation and any verified fixes**

```bash
git add README.md app package.json package-lock.json shopify.app.toml vitest.config.ts
git commit -m "docs: add StockPulse setup and metric guide"
```

- [ ] **Step 6: Final repository state**

Ensure the implementation branch is clean and ahead of `origin/main`. Do not push or open a pull request unless separately authorized.
