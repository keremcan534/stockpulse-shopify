# StockPulse Purchase Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add budget-aware purchasing, demand/delivery scenarios and honest no-sales stock valuation to the existing Shopify inventory dashboard.

**Architecture:** Keep Shopify reads server-side and algorithms as pure TypeScript. The loader supplies catalog/sales/cost metadata; client components compute draft plans and CSV without mutations or persistence.

**Tech Stack:** Existing React 18, React Router 7, Shopify Polaris web components, TypeScript, Vitest and Testing Library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-purchase-assistant-design.md`

## Global Constraints

- Keep Shopify Admin API `2026-07` and existing read scopes only.
- No Shopify mutations, automatic orders, paid services, external messages, or public deployment.
- No guaranteed revenue, savings, optimal allocation, AI confidence percentage, or historical stockout-correction claims.
- Missing cost and unavailable sales are unknown, never zero. Currency must match the shop currency; no conversion.
- Only tracked, ACTIVE, non-gift-card variants with at least 30 days of known age and valid sales/cost data can receive automatic purchasing quantities.
- A positive-stock variant is “dead stock” only when its known age is at least 60 days and available 60-day sales are zero.
- Recommendations use observed 30-day sales, not proof of continuous availability. Dates use the loader's fixed UTC timestamp.
- All new input state is local to the current page; CSV export is a draft for review, not a placed order.
- Preserve existing search, status filtering, authentication/reauthorization handling, catalog pagination and degraded sales behavior.

## File responsibilities

`inventory.types.ts`: serializable shared contracts. `shopify-graphql.server.ts`: existing envelope/auth response handling extracted unchanged. `shopify-costs.server.ts`: optional paginated unit cost read. `shopify-inventory.server.ts`: catalog metadata, currency, sales, safe cost merge. `inventory-metrics.ts`: safe age/availability classification.

`planning-money.ts`: decimal-to-minor-unit validation and formatting. `purchase-planning.ts`: pure eligibility, allocator and no-sales valuation. `purchase-csv.ts`: safe portable CSV. `purchase-assistant.tsx`: page state and scenario comparisons. `purchase-plan-table.tsx`: editable rows. `no-sales-stock.tsx`: valuation coverage. `purchase-assistant.module.css`: responsive presentation. Existing dashboard composes these components.

### Task 1: Shopify planning data and honest history states

**Files:** Modify `app/features/inventory/inventory.types.ts`, `shopify-inventory.server.ts`, `inventory-metrics.ts`, `inventory-dashboard.tsx`, `app/routes/app._index.tsx`; create `shopify-graphql.server.ts`, `shopify-costs.server.ts`; modify corresponding existing tests and create `shopify-costs.server.test.ts` if the cost tests merit separation.

**Interfaces:**
```ts
// Required additions to CatalogVariant; nullable means unknown, not false/zero.
createdAt: string | null;
productStatus: string | null;
isGiftCard: boolean | null;
unitCost: { amount: string; currencyCode: string } | null;
// Required additions to ShopifyInventoryResult and InventoryDashboardData:
currencyCode: string | null;
costWarning: string | null;
// InventoryDashboardData also carries salesAvailable: boolean.
// Add states to InventoryStatus:
// "insufficient-history" | "unavailable"
// Change calculation to accept a fixed now, with all call sites updated:
calculateInventoryRows(catalog: CatalogVariant[], sales: VariantSales[], salesAvailable: boolean, now: Date): InventoryRow[];
export function variantAgeDays(createdAt: string | null, now: Date): number | null;
```

- [ ] Add failing repository tests first. Fixtures now contain known old creation dates, ACTIVE status, false giftCard and nullable cost. Cost rejection must leave rows and sales intact, costWarning non-null, unitCosts null; a thrown auth Response must propagate. Add multi-page cost merge, nullable costs and currency response tests. Preserve all existing order pagination/auth cases.
```ts
expect(result.catalog[0].unitCost).toEqual({ amount: "12.50", currencyCode: "USD" });
expect(denied.salesAvailable).toBe(true);
expect(denied.catalog[0].unitCost).toBeNull();
expect(denied.costWarning).toBeTruthy();
```
- [ ] Add failing metrics tests using `now = new Date("2026-08-27T12:00:00Z")`: age59 days + 0 sales != dead; exact age60 + 0 sales = dead; age10 or unknown + sales shows null daily estimate/reorder; unavailable sales with positive stock state unavailable; zero/negative stock remains out-of-stock. Update old fixtures to truly old variants, not to suppress assertions.
```ts
expect(calculateInventoryRows([young], [], true, now)[0].status).toBe("insufficient-history");
expect(calculateInventoryRows([old], [], true, now)[0].status).toBe("dead-stock");
expect(calculateInventoryRows([old], [], false, now)[0].status).toBe("unavailable");
```
- [ ] Run focused tests and record the expected RED. Use `npm test -- app/features/inventory/shopify-inventory.server.test.ts app/features/inventory/inventory-metrics.test.ts`.
- [ ] Search Shopify toolkit docs before modifying GraphQL. Extract existing executeGraphql/Response handling into `shopify-graphql.server.ts`, preserving behavior. Add createdAt, product { title status isGiftCard } and shop { currencyCode } to catalog query. Unknown/invalid new metadata becomes null; never infer ACTIVE or false. A valid date must not be in the future for age calculations. Currency is nullable on invalid metadata. Existing required catalog validation remains strict.
```graphql
query StockPulseCosts($after: String) {
  productVariants(first: 100, after: $after) {
    nodes { id inventoryItem { unitCost { amount currencyCode } } }
    pageInfo { hasNextPage endCursor }
  }
}
```
- [ ] Implement optional cost loading after required catalog and sales (can sequence, no complex parallel-error plumbing). Use same envelope helper. Validate nodes/pageInfo, detect missing/repeated cursor, normalize nullable/malformed costs to null. Any cost-read failure clears all costs and emits a fixed safe warning; auth Responses propagate. Join by variant ID. Do not add scopes or expose server error details. Keep availableInventory finite; do not silently create a tracked zero-stock record from invalid data.
- [ ] Implement `variantAgeDays` as elapsed UTC milliseconds / 86_400_000, null for unknown/invalid/future dates. Under30/unknown: null rates/cover/reorder (counts can remain observed); age30–59 zero-sales => insufficient-history; age60+ zero-sales => dead. Preserve out-of-stock and not-tracked precedence. When sales unavailable positive tracked stock is unavailable, not healthy.
- [ ] Pass fixed now, currencyCode, costWarning and salesAvailable from loader. Add the two labels/tones/filter options and adjust existing explanatory copy; no new purchase UI in this task. Update fixtures for required fields, preserving existing assertions and tests.
- [ ] Run Shopify toolkit schema validation for changed queries, focused GREEN, then `npm test`, `npm run setup`, `npm run typecheck` once before commit. Commit as `feat: load safe planning metadata and costs` and report RED/GREEN evidence.

### Task 2: Pure budget, scenario, valuation and CSV engine

**Files:** Create `app/features/inventory/planning-money.ts`, `planning-money.test.ts`, `purchase-planning.ts`, `purchase-planning.test.ts`, `purchase-csv.ts`, `purchase-csv.test.ts`.

**Consumes:** CatalogVariant/InventoryRow required fields from Task1; `variantAgeDays(createdAt, now)`; dashboard salesAvailable and shop currencyCode.

**Produces:** Define/export these exact public contracts (extra private helpers are allowed):
```ts
export interface PlanningInputs {
  budget: string; leadTimeDays: number; targetCoverDays: number;
  delayDays: number; demandChangePercent: number;
}
export interface PurchasePlanRow {
  variantId: string; productTitle: string; variantTitle: string; sku: string | null;
  need: number; quantity: number; unitCostMinor: number | null; lineCostMinor: number | null;
  daysOfStock: number | null;
  action: "buy" | "defer" | "check-data" | "no-purchase";
  reason: string;
}
export interface PurchasePlan {
  rows: PurchasePlanRow[]; currencyCode: string | null; inputs: PlanningInputs;
  budgetMinor: number | null; totalCostMinor: number; remainingBudgetMinor: number | null;
  neededUnits: number; unfilledUnits: number; stockoutsBeforeDelivery: number;
  errors: string[]; exportable: boolean;
}
export function buildPurchasePlan(rows: InventoryRow[], currencyCode: string | null,
  inputs: PlanningInputs, now: Date, edits?: Record<string, string>): PurchasePlan;
export interface NoSalesStockSummary {
  totalCostMinor: number | null; currencyCode: string | null;
  qualifyingVariants: number; knownCostVariants: number; missingCostVariants: number;
  knownCostUnits: number; missingCostUnits: number; salesAvailable: boolean;
  rows: Array<{variantId: string; productTitle: string; variantTitle: string;
    sku: string | null; units: number; costMinor: number | null}>;
}
export function summarizeNoSalesStock(rows: InventoryRow[], currencyCode: string | null,
  salesAvailable: boolean, now: Date): NoSalesStockSummary;
export function currencyDigits(currencyCode: string | null): number | null;
export function parseMoneyMinor(value: string, currencyCode: string | null,
  roundUp?: boolean): number | null;
export function formatMoneyMinor(value: number | null, currencyCode: string | null): string;
export function purchasePlanCsv(plan: PurchasePlan): string; // empty string if !exportable
```

- [ ] Write failing money tests then run `npm test -- app/features/inventory/planning-money.test.ts`. Decimal parsing must reject blank/negative/nonfinite/scientific/unsafe values and >1e9 units for budget (budget cap belongs to planner). Intl fraction digits supports JPY/USD/KWD. Costs round up fractional minor units, budgets reject too much precision. Only known Intl supported currencies, never silently assume 2 digits for an invalid code.
```ts
expect(parseMoneyMinor("0.29", "USD")).toBe(29);
expect(parseMoneyMinor("1.001", "USD", true)).toBe(101);
expect(parseMoneyMinor("1.001", "USD")).toBeNull();
expect(parseMoneyMinor("1.234", "KWD")).toBe(1234);
expect(parseMoneyMinor("120", "JPY")).toBe(120);
expect(parseMoneyMinor("", "USD")).toBeNull();
```
- [ ] Implement integer-safe money parsing with decimal string operations and BigInt internally if useful (do not return BigInt in serialized outputs). Format unknown as “Unknown”. Refactor only after GREEN.
- [ ] Write failing plan tests with ACTIVE/tracked/non-gift, 100-day-old fixtures. `units30Days=30`, stock3, unitCost USD2, budget10, lead7, cover30 => need34, quantity5, total1000 minor, unmet29. Another less-urgent row should not displace it. Stocknegative clamps0 in need. Scenario demand+30%, delay7 => need55 with stock3 (ceil(1.3*44−3)=55). Exact 31 units/30days ×30 horizon must not become32.
```ts
const inputs = { budget: "10", leadTimeDays: 7, targetCoverDays: 30, delayDays: 0, demandChangePercent: 0 };
expect(plan.rows[0]).toMatchObject({ need: 34, quantity: 5, action: "buy" });
expect(plan.totalCostMinor).toBe(1000);
expect(plan.unfilledUnits).toBe(29);
expect(plan.remainingBudgetMinor).toBe(0);
```
- [ ] Add tests for zero budget, actual zero cost, missing/mismatched/malformed cost, unavailable sales, draft/archived/unknown status, gift card/unknown flag, untracked, under30/unknown/future age, no velocity, input bounds and blank budget. Allocation must remain safe across deterministic generated budgets/costs; stable variant-ID tie break; no mutation of inputs. Edits accept integer strings0..need, invalid/overbudget edits set errors and prevent export. Edits are manual whole-plan overrides of selected rows; unchanged rows retain automatic allocation (no hidden reallocation).
- [ ] Run RED then implement plan: validate inputs, derive eligible demand, calculate integer need with near-integer epsilon tolerance, sort days-of-stock then ID, greedily allocate affordable whole units. Row reasons explicitly identify excluded/unknown/no-sales/budget-shortfall/urgency. Count risk only for measurable positive demand, using stock/demand < total lead. Validate sums/products against safe integer bounds. Invalid plans allocate nothing or preserve clearly marked invalid edit totals but never export. No exception on malformed user input.
- [ ] Add failing valuation tests: two old zero-sales rows stock10 costUSD2 and stock5 costnull => total2000, known1 missing1, knownunits10 missingunits5. New/gift/untracked/nonpositive rows excluded. All costs missing => totalnull. Sales unavailable => unknown total; true empty qualifying set + available sales =>0. Currency mismatch missing; no cost values claimed recovered.
```ts
expect(summary).toMatchObject({totalCostMinor: 2000, knownCostVariants: 1, missingCostVariants: 1});
expect(summarizeNoSalesStock(rows, "USD", false, now).totalCostMinor).toBeNull();
```
- [ ] Add failing CSV tests then implement quote-all-cells RFC4180-style CSV, CRLF rows, only quantity>0 valid rows. Include assumption columns (budget,lead,cover,delay,demand change), quantities/cost/currency/reason. Escape quotes and newlines; prefix text with apostrophe if first non-space character is =,+,-,@ or starts tab/CR/LF. Numeric fields derive from validated numbers. Return empty for invalid/empty plans.
```ts
expect(purchasePlanCsv(invalidPlan)).toBe("");
expect(purchasePlanCsv(formulaSkuPlan)).toContain("'=HYPERLINK");
```
- [ ] Run focused GREEN, `npm test`, `npm run typecheck`, `npm run lint`; commit as `feat: add budget and scenario planning engine`. Report exact public exports and evidence; no UI changes.

### Task 3: Embedded purchase workspace and export

**Files:** Create `app/features/inventory/purchase-assistant.tsx`, `purchase-plan-table.tsx`, `no-sales-stock.tsx`, `purchase-assistant.module.css`, `purchase-assistant.test.tsx`; modify `inventory-dashboard.tsx`, `inventory-dashboard.test.tsx`, `README.md`.

**Consumes:** Task1 `InventoryDashboardData` with rows/currencyCode/costWarning/salesAvailable/generatedAt. Task2 contracts `PlanningInputs`, `buildPurchasePlan`, `summarizeNoSalesStock`, `formatMoneyMinor`, `purchasePlanCsv` exactly as defined above.
**Produces:** `PurchaseAssistant(props: Pick<InventoryDashboardData, "rows" | "currencyCode" | "costWarning" | "salesAvailable" | "generatedAt">)` embedded above existing inventory section inside the existing s-page. Child components can use exported Task2 types.

- [ ] Write failing Testing Library tests for rendered labels, a known old fixture with velocity and cost, and changing budget. Initial state budget1000, lead7, cover30, delay0, demand0. Form state stores raw strings so blank invalid numeric input is not coerced to zero; derived numeric values use NaN for empty and engine errors displayed. Give all controls stable accessible labels.
```tsx
render(<PurchaseAssistant {...fixture} />);
expect(screen.getByRole("heading", {name: "Purchase planner"})).toBeInTheDocument();
await user.clear(screen.getByLabelText(/Purchasing budget/));
await user.type(screen.getByLabelText(/Purchasing budget/), "10");
expect(screen.getByRole("button", {name: "Download buying list CSV"})).toBeEnabled();
```
- [ ] Run RED using `npm test -- app/features/inventory/purchase-assistant.test.tsx`.
- [ ] Implement accessible responsive UI with three coherent areas: Purchase planner, What-if comparison, Cost in no-sales stock. Planner inputs: Purchasing budget (explicit currency), Lead time (days), Target cover after arrival (days); scenario inputs: Extra delivery delay (days), Demand change (%). Scenario controls visibly apply to the buying list; baseline comparison always uses delay0/demand0 with the same budget/lead/cover. Use a small comparison table for baseline/scenario risk, need, spend and unmet units. Label it assumptions, not forecasts.
```tsx
const baseline = useMemo(() => buildPurchasePlan(rows, currencyCode,
  { ...inputs, delayDays: 0, demandChangePercent: 0 }, now), [rows, currencyCode, inputs, now]);
const scenario = useMemo(() => buildPurchasePlan(rows, currencyCode, inputs, now, edits),
  [rows, currencyCode, inputs, now, edits]);
```
- [ ] Add editable quantity per buying row, accessible label includes product and SKU/variant. Show calculated need, selected quantity, unit/line cost, action and reason; display excluded/check-data rows without editable inputs. Use a native table with scoped headers, horizontal overflow container and caption; cost coverage list may be details/collapsible. All amounts label currency; a current-cost-only note excludes shipping/taxes/supplier changes. No unrequested design system/dependency.
- [ ] Add tests for scenario demand+30/delay7 differences, quantity edits update totals, overbudget/blank/invalid input disables CSV, assumption change resets edits and displays a notice, cost warning and missing-cost coverage, new-item no-dead-stock presentation, no candidates with zero sales. Preserve search/status tests; new helper fixtures stay in test files.
- [ ] Implement download click using `purchasePlanCsv(scenario)`, `Blob`, `URL.createObjectURL`, an anchor download named `stockpulse-buying-list.csv`, and object URL cleanup. Do not open new network endpoints. Test Blob contents via mocked browser object-URL boundary while asserting real CSV output, download filename, and revocation. Confirm no download on invalid plan.
```tsx
const csv = purchasePlanCsv(scenario);
if (!csv) return;
const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
// Click temporary anchor, then remove it and revoke URL in a finally path.
```
- [ ] Document formulas, eligibility, currency rounding, costs permissions, limitations and temporary inputs in README. Do not claim automatic PO, saved scenarios or real sales uplift. This feature uses read-only data.
- [ ] Run focused GREEN, full `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`. Use react-best-practices skill after editing TSX. Commit as `feat: add embedded purchase planning workspace`; report test evidence and UI paths. Controller performs live browser verification and whole-branch review afterward.
