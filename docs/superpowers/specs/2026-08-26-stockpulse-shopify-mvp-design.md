# StockPulse Shopify Embedded MVP Design

## Purpose

StockPulse gives a Shopify merchant one embedded dashboard that identifies inventory risk at the product-variant level. The MVP answers four questions: which variants are low on stock, how many days their stock is expected to last, which stocked variants are not selling, and how many units should be reordered.

## Scope

The MVP includes:

- A Shopify Admin embedded application.
- A single inventory dashboard for product variants.
- Summary counts for low-stock and dead-stock variants.
- Variant-level inventory, sales velocity, days of stock, status, and reorder recommendation.
- Filtering by inventory status and text search by product, variant, or SKU.
- Loading, empty, partial-data, and recoverable error states.

The MVP excludes:

- Automatic purchase orders or inventory mutations.
- Email, SMS, or push notifications.
- Billing, subscriptions, and usage limits.
- Forecasting models, seasonality, supplier lead-time management, and configurable thresholds.
- Multi-store aggregation, exports, and scheduled background synchronization.
- A separate merchant-facing settings area.

## Technical Approach

Use Shopify's official React Router application template. The app runs inside Shopify Admin using App Bridge, uses Polaris web components for its interface, and authenticates server-side Admin GraphQL API requests through `@shopify/shopify-app-react-router`.

The official template remains responsible for OAuth, session storage, required webhooks, and Shopify CLI configuration. StockPulse adds a focused server-side inventory domain module and replaces the template's sample home page with the dashboard.

The MVP computes metrics on demand. It does not introduce an analytics database or background worker. This keeps the first release small and makes Shopify the source of truth. Pagination is required so the calculation is correct for stores whose relevant data spans multiple GraphQL pages.

## Shopify Data and Permissions

The application requests only these read scopes:

- `read_products` for products, variants, titles, SKUs, and tracking metadata.
- `read_inventory` for current available inventory across active locations.
- `read_orders` for the previous 60 days of order line items.

Inventory is aggregated across active locations for each inventory-tracked variant. Untracked variants are retained in the response but shown as `Not tracked`; they are excluded from low-stock, dead-stock, and reorder summary counts.

Sales history covers the rolling 60-day window ending at request time. Cancelled orders contribute zero units. For eligible orders, net units sold use the line item's current quantity so removed or fully refunded units do not inflate demand. The aggregation key is the Shopify product variant ID. Line items that no longer reference an existing variant are ignored.

If order history cannot be read but inventory and catalog data are available, the dashboard returns inventory rows with sales-derived fields marked unavailable and displays a warning. Authentication failures follow the template's Shopify reauthorization flow. Other API failures produce a retryable error state and never fabricate metrics.

## Metric Definitions

All calculations operate per product variant and use whole units for inventory and reorder quantities.

### Average daily sales

`averageDailySales = netUnitsSoldInLast30Days / 30`

The fixed 30-day denominator intentionally includes no-sale days. Values are displayed to two decimal places but calculations retain full precision.

### Days of stock

- If available inventory is zero or below, days of stock is `0`.
- If average daily sales is greater than zero, `daysOfStock = availableInventory / averageDailySales`.
- If average daily sales is zero and available inventory is positive, days of stock is unavailable and displayed as `—` rather than infinity.

Displayed finite values are rounded to one decimal place.

### Low stock

A tracked variant is low stock when average daily sales is greater than zero and its days of stock is less than or equal to 14 days. A tracked variant with inventory at or below zero is also low stock, even when its recent sales velocity is zero.

### Dead stock

A tracked variant is dead stock when available inventory is greater than zero and net units sold over the previous 60 days is zero. Dead stock takes display precedence over the healthy status. It is not counted as low stock unless inventory is at or below zero, which cannot simultaneously satisfy the dead-stock definition.

### Reorder recommendation

The target coverage is 30 days:

`recommendedReorderQuantity = max(0, ceil(averageDailySales * 30 - availableInventory))`

The recommendation is zero for untracked variants and for variants with zero average daily sales. The MVP presents this as advisory information only and never modifies Shopify inventory.

### Status precedence

Each row receives exactly one display status in this order:

1. `Not tracked`
2. `Out of stock` when available inventory is zero or below
3. `Dead stock`
4. `Low stock`
5. `Healthy`

## Dashboard Experience

The dashboard uses one Shopify Admin page with:

- A title and short explanation that recommendations are based on recent sales.
- Summary cards for total tracked variants, low/out-of-stock variants, and dead-stock variants.
- A search field for product title, variant title, or SKU.
- A status filter with `All`, `Low stock`, `Out of stock`, `Dead stock`, `Healthy`, and `Not tracked`.
- A table with Product / Variant, SKU, Available, 30-day sales, Daily sales, Days of stock, Status, and Reorder columns.

The initial sort places `Out of stock`, `Low stock`, and `Dead stock` rows first, then sorts by ascending finite days of stock and finally by product title. Search and status filtering occur against the normalized server result and do not trigger Shopify mutations.

The empty state distinguishes between a store with no variants and a filter with no matches. A data warning remains visible while partial results are displayed. A full failure shows a retry action.

## Component and Module Boundaries

- The authenticated dashboard route owns request authentication, data loading, and response/error boundaries.
- A Shopify inventory repository owns GraphQL documents, pagination, response validation, and normalization into catalog and sales records.
- A pure inventory-metrics module combines normalized records and calculates all metrics and statuses. It has no Shopify, React, or database dependency.
- Focused dashboard components render summary cards, controls, table rows, warnings, and empty states. They receive already-calculated view data.

These boundaries allow metric rules to be tested without Shopify credentials and API normalization to be tested independently from rendering.

## Testing Strategy

Unit tests cover:

- Thirty-day velocity and fixed-denominator behavior.
- Zero and negative inventory.
- Zero-sales days-of-stock behavior.
- Low-stock boundary at exactly 14 days.
- Dead-stock classification using 60-day sales.
- Reorder rounding and its lower bound of zero.
- Status precedence and untracked variants.

Repository tests cover GraphQL response normalization, multi-page aggregation, cancelled orders, refunded quantities, missing variants, and partial order-data failure.

Route/component tests cover summary counts, default ordering, search, status filtering, empty states, warnings, and retryable errors. The final verification includes type checking, linting, automated tests, a production build, and an embedded development-store smoke test when Shopify authentication is available.

## Acceptance Criteria

- The app opens inside Shopify Admin using the official embedded authentication flow.
- The dashboard lists all accessible product variants without silently truncating GraphQL pages.
- Every tracked variant displays inventory and the specified deterministic metrics.
- Summary counts and filters agree with the row-level status definitions.
- Untracked inventory and unavailable sales history are communicated explicitly.
- No MVP action writes products, orders, or inventory to Shopify.
- Automated tests verify the metric rules and primary dashboard states.
- Type checking, linting, tests, and the production build complete successfully.

## Delivery Sequence

1. Scaffold the official Shopify React Router application in the empty repository.
2. Add metric tests and the pure calculation module using test-driven development.
3. Add Shopify data normalization and pagination with repository tests.
4. Build the authenticated dashboard and its UI states.
5. Run automated verification, then connect Shopify CLI to a development store for the embedded smoke test.
