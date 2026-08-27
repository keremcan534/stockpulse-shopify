# StockPulse for Shopify

StockPulse is a read-only embedded Shopify app that helps merchants decide what to reorder and what is tying up cash. Its single dashboard shows current inventory, recent sales velocity, estimated days of stock, low-stock risk, dead stock, advisory reorder quantities, and a local purchase-planning workspace.

## Purchase planning workspace

The embedded workspace is a review aid; it never creates purchase orders or changes Shopify data. It starts with a budget of 1,000 shop-currency units, a seven-day lead time, and 30 days of target cover after delivery. Budget, lead time, target cover, extra delivery delay, and demand change are temporary inputs on the current page only.

- Only tracked, ACTIVE, non-gift-card variants at least 30 days old with available 30-day sales and a valid current unit cost can receive a buying quantity.
- Need is the whole-unit ceiling of adjusted daily demand across lead time plus target cover, less non-negative available stock. The scenario applies its demand and delivery changes to the same budget allocator; it is an assumption, not a forecast.
- Money uses currency-aware integer minor units, including currencies with zero, two, or three decimal digits. Fractional cost values are rounded conservatively upward. Amounts exclude shipping, taxes, and supplier quote changes.
- Quantity edits are limited to calculated need. Invalid inputs or an over-budget edited plan disable CSV export; changing assumptions visibly resets edits.
- The CSV is a local review draft containing selected rows and assumptions. Text fields are quoted, escaped, and spreadsheet-formula neutralized.

The no-sales cost area values only tracked, non-gift-card, positive-stock variants with at least 60 days of known age and zero observed 60-day sales. It reports missing costs as unknown rather than zero. This is current inventory cost, not recoverable cash, profit, loss, or historical acquisition cost. A young store or unavailable sales history deliberately produces no buying quantities or no-sales classification instead of fabricated demand.

## MVP behavior

StockPulse calculates every metric at the product-variant level:

- **Average daily sales:** net units sold in the previous 30 days divided by 30. No-sale days remain in the denominator.
- **Days of stock:** available inventory divided by average daily sales. It is shown as `—` when a stocked variant has no sales velocity.
- **Low stock:** a tracked variant with 14 or fewer days of stock.
- **Out of stock:** a tracked variant with zero or negative available inventory.
- **Dead stock:** a tracked variant with positive inventory and no net units sold in the previous 60 days.
- **Reorder recommendation:** the whole-unit quantity needed to reach 30 days of inventory at the current sales velocity.

The recommendation is informational. StockPulse never changes products, orders, or inventory.

## Data access

The app requests only these Shopify Admin API scopes:

- `read_products`
- `read_inventory`
- `read_orders`
- `read_inventory` access also provides current unit costs where Shopify permissions allow it

Catalog, order, and line-item connections are paginated. Refunded or removed quantities are handled through Shopify's `currentQuantity`; cancelled orders and line items whose variant no longer exists are ignored.

If order history is temporarily unavailable, StockPulse still displays catalog and inventory data. Sales-derived cells become unavailable and a warning explains the partial result. If cost access is denied or incomplete, catalog and sales data remain available and the purchase workspace labels cost coverage as incomplete.

## Architecture

- Shopify's official React Router embedded-app template handles OAuth, App Bridge, webhooks, and session storage.
- `app/features/inventory/shopify-inventory.server.ts` owns read-only Admin GraphQL queries, pagination, validation, and normalization.
- `app/features/inventory/inventory-metrics.ts` contains dependency-free inventory calculations, filtering, summaries, and sorting.
- `app/features/inventory/inventory-dashboard.tsx` renders the responsive Polaris-based dashboard.
- Prisma and SQLite store Shopify sessions during local development.

The app targets Shopify Admin API `2026-07`.

## Requirements

- Node.js `>=20.19 <22` or `>=22.12`
- npm
- A Shopify developer account and development store
- Shopify CLI (latest)

Install Shopify CLI if it is not already available:

```bash
npm install -g @shopify/cli@latest
```

## Local setup

Install dependencies and prepare the session database:

```bash
npm install
npm run setup
```

The setup command safely creates the local SQLite file if it is missing,
then generates Prisma Client and applies migrations. Existing session data
is preserved.

Link the project to an existing Shopify app or let the development command create/select one:

```bash
shopify app config link
shopify app dev
```

Shopify CLI will prompt for the developer organization, development store, and app installation when needed. After installation it opens the embedded dashboard in Shopify Admin.

## Verification

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

The automated suite covers metric boundaries, status precedence, sorting and filtering, paginated Shopify response normalization, partial data, loader orchestration, dashboard states, and deterministic timestamp rendering.

## Scope boundaries

The MVP intentionally does not include automatic purchase orders, inventory mutations, notifications, billing, saved scenarios, supplier integrations, forecasting models, background synchronization, or multi-store aggregation. The review-only CSV and local scenario controls are deliberately limited to the active page session.

The approved design and implementation plan live in:

- `docs/superpowers/specs/2026-08-26-stockpulse-shopify-mvp-design.md`
- `docs/superpowers/plans/2026-08-26-stockpulse-shopify-mvp.md`

## Shopify references

- [Scaffold an app](https://shopify.dev/docs/apps/build/scaffold-app)
- [Shopify App package for React Router](https://shopify.dev/docs/api/shopify-app-react-router/latest)
- [Admin GraphQL API](https://shopify.dev/docs/api/admin-graphql/2026-07)
