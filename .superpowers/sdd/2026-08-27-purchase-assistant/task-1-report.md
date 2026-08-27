# Task 1 report — Shopify planning data and honest history states

## Delivered

- Added nullable catalog planning metadata (`createdAt`, product status, gift-card state, unit cost) and nullable shop currency.
- Extracted shared Shopify GraphQL response/envelope and pagination validation into `shopify-graphql.server.ts` without changing authentication/reauthorization response behavior.
- Added a separately paginated, optional unit-cost read. Any non-auth cost failure leaves catalog and sales intact, clears costs, and returns the fixed safe warning. Authentication control-flow Responses propagate.
- Added age-aware inventory states and metrics: `insufficient-history`, `unavailable`, fixed loader time, safe UTC elapsed-age calculation, and correct out-of-stock/not-tracked precedence.
- Passed the new loader fields to the dashboard, rendered the cost warning, and added filter labels/tones for the new states.

## TDD evidence

### RED

Command:

```text
npm test -- app/features/inventory/shopify-inventory.server.test.ts app/features/inventory/inventory-metrics.test.ts
```

Result after the sandbox permission retry: 2 test files failed; 4 tests failed and 30 passed. The failures were the intended missing behaviors: missing planning metadata from catalog, unavailable sales still reported as healthy, a 59-day zero-sales variant reported as dead stock, and young/unknown variants still receiving estimates.

Additional regression RED command:

```text
npm test -- app/features/inventory/inventory-metrics.test.ts
```

Result: 1 test file failed; 2 tests failed and 23 passed. The failures proved young/unknown out-of-stock and untracked variants still produced estimates, and an invalid `now` produced `NaN` age.

### GREEN

Command:

```text
npm test -- app/features/inventory/shopify-inventory.server.test.ts app/features/inventory/shopify-costs.server.test.ts app/features/inventory/inventory-metrics.test.ts app/features/inventory/inventory-dashboard.test.tsx app/features/inventory/inventory-route.test.ts
```

Result: 5 test files passed; 52 tests passed.

## Validation

- Shopify Admin documentation search was performed for `ProductVariant createdAt product status isGiftCard InventoryItem unitCost Shop currencyCode` using API version `2026-07`.
- Shopify Admin schema validation passed for `StockPulseCatalog` (required scopes reported: `read_products`, `read_inventory`).
- Shopify Admin schema validation passed for `StockPulseCosts` (required scopes reported: `read_products`, `read_inventory`).
- `npm run setup` passed: Prisma client generated and the one local SQLite migration applied.
- `npm run typecheck` passed.
- Final `npm test` passed: 6 test files and 54 tests passed.
- `git diff --check` passed with no whitespace errors. Git emitted pre-existing host warnings about inaccessible global ignore configuration and CRLF normalization only.

## Files changed

- `app/features/inventory/inventory.types.ts`
- `app/features/inventory/inventory-metrics.ts`
- `app/features/inventory/inventory-metrics.test.ts`
- `app/features/inventory/inventory-dashboard.tsx`
- `app/features/inventory/inventory-dashboard.test.tsx`
- `app/features/inventory/shopify-graphql.server.ts` (new)
- `app/features/inventory/shopify-costs.server.ts` (new)
- `app/features/inventory/shopify-costs.server.test.ts` (new)
- `app/features/inventory/shopify-inventory.server.ts`
- `app/features/inventory/shopify-inventory.server.test.ts`
- `app/features/inventory/inventory-route.test.ts`
- `app/routes/app._index.tsx`

## Self-review

- Verified required catalog fields stay strict while optional planning metadata normalizes to `null`.
- Verified cost reads only update catalog after all pages load, so partial/rejected cost reads cannot leak a partial value; repeated/missing cursors are rejected.
- Verified a valid date in the future, invalid dates, and invalid loader timestamps return unknown age; young/unknown variants have no estimates even when the out-of-stock/not-tracked status takes precedence.
- Verified sales failures are represented as `unavailable` for positive tracked stock, without changing out-of-stock or not-tracked states.

## Concerns

None. The cost permission itself is store-role dependent; the implementation deliberately degrades to the fixed safe warning when Shopify denies or otherwise fails that optional read.

## Follow-up fix — cost boundary validation

Review identified that unit costs had only string-shape validation and were not checked against the shop currency. The cost loader now accepts only finite, nonnegative decimal amount strings and only retains a cost whose currency exactly matches the nullable shop currency. Missing/invalid shop currency, malformed amounts, and mismatched currencies are represented as unknown (`null`), with no conversion.

### RED

Command:

```text
npm test -- app/features/inventory/shopify-costs.server.test.ts
```

Result: 1 test file failed; 1 test failed and 4 passed. The new test received `{ amount: "not-a-number", currencyCode: "USD" }` and `{ amount: "3.00", currencyCode: "EUR" }` from a USD shop and proved both were incorrectly retained.

### GREEN

Command:

```text
npm test -- app/features/inventory/shopify-costs.server.test.ts app/features/inventory/shopify-inventory.server.test.ts
```

Result: 2 test files passed; 16 tests passed.

`npm run typecheck` also passed after the fix.
