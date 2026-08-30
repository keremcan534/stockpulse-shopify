# StockPulse — Claude Development Handoff

Last updated: 30 August 2026

## 1. Purpose

StockPulse is a read-only embedded Shopify app that helps merchants understand
inventory risk and prepare purchasing decisions. The product is intended to be
validated with real merchant interest before billing or public production
deployment is added.

The current product answers four core questions:

1. Which variants are low or out of stock?
2. How many days of stock remain at recent sales velocity?
3. Which inventory has had no recent sales and may be tying up cash?
4. What quantities could be reordered under a merchant-defined budget and
   lead-time scenario?

Do not claim that merchant interest, pilots, revenue, or willingness to pay has
already been measured. The committed pilot counters are intentionally zero.

## 2. Current repository state

- Branch: `main`
- Latest known commit before this handoff: `28ff961`
- Runtime: Node.js `>=20.19 <22` or `>=22.12`
- Framework: Shopify React Router embedded-app template, React 18, Vite,
  Prisma, SQLite for local session storage
- Shopify Admin API target: `2026-07`
- Shopify scopes: `read_products`, `read_inventory`, `read_orders`
- Verification at handoff: 17 test files and 205 tests passed; typecheck,
  ESLint, and production build passed

The Git remote is expected to be:

```text
https://github.com/keremcan534/stockpulse-shopify.git
```

## 3. Implemented Shopify product behavior

### Embedded inventory dashboard

- Variant-level inventory and recent sales normalization
- Average daily sales over 30 days
- Estimated days of stock
- Low-stock and out-of-stock classifications
- Dead/no-sales stock detection using known age and 60-day sales evidence
- Advisory reorder quantity to reach 30 days of cover
- Sorting, filtering, summaries, partial-data warnings, and deterministic
  timestamps

### Purchase-planning workspace

- Merchant-adjustable budget, lead time, target cover, delivery delay, and
  demand scenario
- Currency-aware integer minor-unit calculations
- Cost coverage and missing-cost handling
- Budget allocation without exceeding calculated need
- Editable quantities bounded by calculated need
- CSV review export with quoting, escaping, and spreadsheet-formula
  neutralization
- No purchase order creation and no Shopify mutation

### Privacy and pilot surfaces

- Public fictional demo using sample data only
- Privacy/data-use page
- Shopify compliance webhook route and tests
- Pilot documentation that explicitly reports zero measured interest

## 4. Important architecture

### Shopify data and inventory logic

- `app/features/inventory/shopify-inventory.server.ts`
  - Read-only Admin GraphQL inventory/order access, pagination, validation,
    normalization, and partial-data handling.
- `app/features/inventory/shopify-costs.server.ts`
  - Current variant cost retrieval and coverage reporting.
- `app/features/inventory/shopify-graphql.server.ts`
  - Shared GraphQL execution utilities.
- `app/features/inventory/inventory-metrics.ts`
  - Dependency-free inventory metrics and classifications.
- `app/features/inventory/purchase-planning.ts`
  - Pure purchasing-need and budget-allocation logic.
- `app/features/inventory/planning-money.ts`
  - Currency-aware money conversion and formatting helpers.
- `app/features/inventory/purchase-csv.ts`
  - Safe local CSV generation.
- `app/features/inventory/inventory-dashboard.tsx`
  - Embedded dashboard UI.
- `app/features/inventory/purchase-assistant.tsx`
  - Client-side scenario and purchasing review UI.

### Routes and privacy

- `app/routes/app._index.tsx` — authenticated embedded dashboard route
- `app/routes/demo.tsx` — public fictional demo
- `app/routes/privacy.tsx` — data-use/privacy information
- `app/routes/webhooks.compliance.tsx` — Shopify privacy compliance topics

### Outreach validation tool

The outreach tool is deliberately separate from Shopify routes and the Prisma
database:

- `scripts/outreach/outreach-domain.mjs` — immutable state transitions,
  approval limits, follow-up scheduling, reply labels, opt-out suppression,
  and summary metrics
- `scripts/outreach/message-templates.mjs` — Turkish plain-text initial and
  follow-up templates
- `scripts/outreach/outreach-store.mjs` — validated, atomic local JSON storage
- `scripts/outreach/outreach-cli.mjs` — local dry-run command-line interface
- `docs/outreach-operator-runbook.md` — exact operator workflow
- `examples/outreach/candidate.example.json` — fictional `.test` seed only

Local operational state belongs in:

```text
.stockpulse-outreach/state.json
```

That directory is gitignored and may contain operational information. Never
commit it.

## 5. Outreach safety invariants

These are security/product requirements, not optional preferences:

- No live sender exists. `preview` and `record-sent` contact nobody.
- Every initial and follow-up message requires separate individual approval.
- Maximum three approved initial messages per local calendar day.
- Maximum one initial and one follow-up per normalized business domain.
- A follow-up becomes due after five business days only if there is no reply
  or opt-out.
- Any reply cancels an unsent follow-up.
- Opt-out is terminal and suppresses the normalized apex/`www` domain alias.
- Non-opt-out outcome labels require evidence of a recorded sent message.
- Raw replies are never stored; only allowed classification labels are stored.
- Candidate URLs must be HTTP(S), contain a hostname, and contain no embedded
  credentials.
- Displayed fields reject control characters.
- Persisted state is validated before an `approved` flag is trusted.
- Network calls are blocked in CLI integration tests, including ESM named
  imports for Node HTTP/socket modules.
- Do not add email discovery, purchased lists, LinkedIn automation, bulk
  approval, automatic retries, or automatic sending.

## 6. Local setup and commands

Install and prepare the app:

```bash
npm install
npm run setup
```

Link/run with Shopify CLI:

```bash
npm run config:link
npm run dev
```

Full verification:

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Outreach dry-run examples:

```bash
npm run outreach -- summary
npm run outreach -- candidate add --input <local-json-file>
npm run outreach -- draft initial --candidate P01
npm run outreach -- approve --message P01-initial
npm run outreach -- preview --message P01-initial
```

Read `docs/outreach-operator-runbook.md` before any operational use.

## 7. Tests and quality expectations

The current suite covers:

- Inventory metric boundaries and status precedence
- Shopify pagination and response normalization
- Partial order/cost data
- Purchase need, budget allocation, money precision, and CSV safety
- Dashboard and purchase-assistant interactions
- Privacy pages and Shopify compliance webhooks
- Outreach approval, daily/domain limits, follow-ups, opt-out, input safety,
  state corruption, atomic persistence, dry-run behavior, and network blocking

For every behavioral change:

1. Add a failing regression test first.
2. Implement the smallest compatible change.
3. Run focused tests while iterating.
4. Run the complete verification commands before committing.
5. Do not weaken a safety assertion to make a test pass.

## 8. Known boundaries and remaining work

The following are intentionally not implemented:

- Shopify App Store production submission
- Durable production hosting and production database
- Billing/subscriptions
- Automatic purchase orders or inventory mutation
- Supplier integrations
- Saved purchasing scenarios or background synchronization
- Live outreach sender, Gmail/SMTP/provider credentials, or delivery retries
- Legal/IYS operational setup
- Public claims of customers, pilots, revenue, or measured demand

Before production or live outreach, separately verify:

- Durable hosting and production configuration
- Privacy request operations and data retention
- Shopify CLI configuration validation
- Sender identity, recipient business status, IYS and applicable legal rules,
  free opt-out handling, and action-time human approval
- A user-approved test sent only to the user's own address after a compliant
  provider is deliberately selected

## 9. Recommended next steps for Claude

Work in this order unless the user explicitly changes priorities:

1. Read this file, `README.md`, `AGENTS.md`, and the relevant design/plan docs.
2. Run `git status --short --branch` and the full verification suite before
   modifying behavior.
3. Confirm the user's immediate goal. Do not broaden scope automatically.
4. If continuing validation, use the dry-run operator workflow first; do not
   add a sender merely to make outreach automatic.
5. If preparing production, prioritize durable hosting, production sessions,
   privacy operations, and Shopify configuration validation before billing or
   marketing work.
6. Preserve the read-only Shopify architecture and all outreach safety
   invariants.
7. Keep real prospects, addresses, replies, tokens, and credentials outside
   Git.

## 10. Reference documents

- `README.md`
- `docs/outreach-operator-runbook.md`
- `outputs/StockPulse-Ucretsiz-Pilot.md`
- `docs/superpowers/specs/2026-08-27-purchase-assistant-design.md`
- `docs/superpowers/plans/2026-08-27-purchase-assistant.md`
- `docs/superpowers/specs/2026-08-29-approved-outreach-automation-design.md`
- `docs/superpowers/plans/2026-08-29-approved-outreach-automation.md`

## 11. Non-negotiable handoff note

The repository is in a verified development state, not a verified production
or commercial state. Continue from evidence in the code and tests. Do not
reinterpret dry-run records, fictional demo data, or zero-valued pilot tables
as real customer traction.
