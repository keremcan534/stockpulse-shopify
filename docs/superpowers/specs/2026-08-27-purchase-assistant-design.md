# StockPulse purchase assistant — approved design

Approved by the user on 2026-08-27: “yapalım bakalım”, following the three-feature proposal in `outputs/StockPulse-Ozellik-Arastirmasi.md` in the parent workspace. This implements that proposal inside the existing embedded inventory app.

## Outcome and boundaries

Give a small merchant one explainable workflow: set a purchasing budget, inspect an editable buying list, compare a delivery/demand scenario, and see the current cost of stock with no sales in the observed 60-day window.

- Keep Shopify Admin API `2026-07` and existing read scopes only.
- No Shopify mutations, automatic orders, paid services, external messages, or public deployment.
- No guaranteed revenue, savings, optimal allocation, AI confidence percentage, or historical stockout-correction claims.
- Missing cost and unavailable sales are unknown, never zero. Currency must match the shop currency; no conversion.
- Only tracked, ACTIVE, non-gift-card variants with at least 30 days of known age and valid sales/cost data can receive automatic purchasing quantities.
- A positive-stock variant is “dead stock” only when its known age is at least 60 days and available 60-day sales are zero.
- Recommendations use observed 30-day sales, not proof of continuous availability. Dates use the loader's fixed UTC timestamp.
- All new input state is local to the current page; CSV export is a draft for review, not a placed order.
- Preserve existing search, status filtering, authentication/reauthorization handling, catalog pagination and degraded sales behavior.

## Data and safety

Add variant creation date, product status, gift-card flag and nullable unit cost to the catalog. Read shop currency with the catalog. Fetch costs separately: a cost permission/API failure must preserve the catalog and sales view with a sanitized cost warning. Authentication/reauthorization Responses still propagate. Paginate cost reads and reject incomplete reads rather than silently treating missing pages as complete.

Add `insufficient-history` and `unavailable` inventory states. Under-30-day/unknown-age variants show observed unit counts but no daily-rate/reorder estimate; 30–59-day no-sales variants are not called dead stock. Out-of-stock and untracked states remain recognizable. Known age is elapsed days since variant creation, not an asserted history of in-stock days.

## Purchase calculation

Defaults: budget 1000 shop-currency units, lead time 7 days, target cover 30 days after arrival, scenario delay 0 days, scenario demand change 0%. Inputs: budget 0–1,000,000,000 currency units; lead time 0–365 whole days; cover 1–365 whole days; extra delay 0–365 whole days; demand change -100% to +500% whole percent. Invalid/blank input produces an explicit error and disables export. No NaN/Infinity or unsafe money integers.

Baseline daily demand is units30Days / 30. Scenario demand multiplies that by 1 + demandChangePercent / 100; scenario lead time adds delayDays. Need = max(0, ceil(adjusted demand × (lead time + target cover) − max(0, available stock))). Negative stock is not assumed to be backorders. Avoid floating-point off-by-one ceilings near integers.

Candidates are sorted by days until stock runs out (ascending), then stable variant ID. This is a simple urgency heuristic, not a globally optimal allocation. Allocate whole units up to need and remaining budget, then move to the next candidate. Never exceed budget. Genuine zero-cost items can be allocated without using budget, but missing costs cannot. Quantities are editable between 0 and calculated need. Edited over-budget/invalid plans show an error and cannot be exported. Changing assumptions resets edits visibly.

Use currency-aware integer minor units for totals and budgets, with conservative upward rounding of a fractional minor-unit cost. Support currencies with 0, 2 and 3 decimal digits; reject invalid/unsafe money. Format with Intl. Purchasing totals exclude shipping, taxes and supplier quote differences.

Each row explains buy now / defer / check data / no purchase needed. Show calculated need, selected quantity, unit cost, line cost and reason. Summary shows selected cost, remaining budget, unfilled units and number of variants projected to run out before delivery. Missing/excluded rows remain inspectable with reasons. SKU and product labels are never treated as spreadsheet formulas.

## Scenario and no-sales cost

Show baseline and scenario side by side for pre-delivery stockout count, needed units, selected cost and unfilled units. Scenario is explicitly a user assumption; it uses the same budget and allocator, not a prediction model. Show changes even when there are no buying candidates without fabricating demand.

For tracked non-gift-card positive-stock variants at least 60 days old with zero observed 60-day sales, sum positive stock × valid current unit cost. Report cost-known and missing-cost variant counts and units, list those variants and costs, and disclose incomplete coverage. If no amount can be valued show “Unknown”, not a misleading zero. If there are truly no qualifying variants and sales are available, show zero with an empty explanation. If sales are unavailable the whole no-sales classification/value is unknown. This is inventory cost, not recoverable cash, profit, loss or historical acquisition cost.

## User interface and acceptance

Keep the existing Polaris embedded page, add a prominent purchase workspace above the inventory table. Use labeled accessible native inputs/buttons, responsive cards and horizontally scrollable data tables. No new component library. English UI matches the existing app. Currency labels must remain explicit.

CSV includes SKU/product/variant, selected quantity, unit cost, line cost, currency and recommendation reason, plus the assumptions so it is interpretable outside the app. Export only selected valid rows; quote and escape cells and neutralize formula-injection text. Provide a disabled state for empty/invalid plans. Download uses a Blob and revokes its object URL.

Acceptance: regression suite plus deterministic domain tests (boundaries, money, exclusions, edits, scenario and cost coverage), repository tests (cost denial and pagination), UI tests (input changes, comparison, validation, edit reset and download), typecheck, lint, production build, and a live embedded browser check. Do not create real orders to seed tests; fixture-based positive scenarios are sufficient alongside the store's genuine empty-sales state.
