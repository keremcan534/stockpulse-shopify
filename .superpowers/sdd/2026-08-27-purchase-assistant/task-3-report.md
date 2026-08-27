# Task 3 report — embedded purchase workspace

## Result

Implemented the embedded StockPulse purchase workspace above the existing inventory area. It uses the Task 2 planning, money, no-sales, and CSV contracts without reimplementing calculation logic.

## Files

- Created `app/features/inventory/purchase-assistant.tsx`: local raw-string assumptions, baseline/scenario plans at the loader timestamp, editable quantities, validation, CSV Blob download/revocation, and safety handling for unavailable sales.
- Created `app/features/inventory/purchase-plan-table.tsx`, `no-sales-stock.tsx`, and `purchase-assistant.module.css`: accessible responsive cards, native tables, inspectable excluded rows, and explicit no-sales cost coverage.
- Created `app/features/inventory/purchase-assistant.test.tsx`: budget, scenario, edit/reset, invalid/over-budget, missing cost, new-item, stale-sales, and CSV object-URL boundary coverage.
- Updated `inventory-dashboard.tsx` and `inventory-dashboard.test.tsx`: embeds the workspace above a named inventory region; existing search/status tests remain scoped to that region.
- Updated `README.md`: formulas, eligibility, currency rounding, cost-permission coverage, limitations, read-only CSV, and temporary inputs.

## TDD evidence

### RED

`npm test -- app/features/inventory/purchase-assistant.test.tsx`

Initial run failed as expected because `./purchase-assistant` did not exist. After the initial feature was built, the focused test identified an over-strict text matcher; it was corrected to assert the rendered currency-labelled behavior. A later focused RED run for stale rows was intentionally added before the implementation adjustment:

`npm test -- app/features/inventory/purchase-assistant.test.tsx`

It failed with `Unable to find an element with the text: Old blue shirt`, proving that excluded stale-sales rows were not yet inspectable.

### GREEN

`npm test -- app/features/inventory/purchase-assistant.test.tsx app/features/inventory/inventory-dashboard.test.tsx`

Passed: 16 tests in 2 test files. The inspectability fix renders the explicit empty-state explanation alongside the accessible excluded-row details.

## Final verification

All final commands completed successfully:

- `npm test` — 10 test files, 111 tests passed.
- `npm run typecheck` — passed.
- `npm run lint` — passed with no warnings/errors.
- `npm run build` — passed. The build emitted existing React Router future-flag warnings only.
- `git diff --check` — no whitespace errors (Git emitted expected CRLF conversion notices).

## React review

Applied the React best-practices checklist: derived plans are memoized from primitive/local state inputs, timestamp parsing is fixed to the loader value, no inline component declarations were added, and only native accessible inputs/tables/buttons are used. Long lists are collapsible and the data table is horizontally scrollable.

## Concerns / handoff

- The controller's live development-store check confirmed all three workspace sections and excluded rows render. A 390px viewport follow-up found card overflow from the detailed table minimum width; this was corrected with zero inline minimums on the grid/card/scroll container and a compact comparison-table minimum width. The buying table remains horizontally scrollable.
- No external service, Shopify mutation, new dependency, or deployment was introduced.
