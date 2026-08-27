import { useMemo, useState } from "react";

import { NoSalesStock } from "./no-sales-stock";
import { formatMoneyMinor } from "./planning-money";
import { purchasePlanCsv } from "./purchase-csv";
import { buildPurchasePlan, summarizeNoSalesStock, type PlanningInputs } from "./purchase-planning";
import { PurchasePlanTable } from "./purchase-plan-table";
import type { InventoryDashboardData } from "./inventory.types";
import styles from "./purchase-assistant.module.css";

type PurchaseAssistantProps = Pick<InventoryDashboardData, "rows" | "currencyCode" | "costWarning" | "salesAvailable" | "generatedAt">;

const defaults = { budget: "1000", leadTimeDays: "7", targetCoverDays: "30", delayDays: "0", demandChangePercent: "0" };

function numberInput(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}

function planningInputs(values: typeof defaults): PlanningInputs {
  return {
    budget: values.budget,
    leadTimeDays: numberInput(values.leadTimeDays),
    targetCoverDays: numberInput(values.targetCoverDays),
    delayDays: numberInput(values.delayDays),
    demandChangePercent: numberInput(values.demandChangePercent),
  };
}

function amount(value: number | null, currencyCode: string | null): string {
  return `${formatMoneyMinor(value, currencyCode)} ${currencyCode ?? ""}`;
}

export function PurchaseAssistant({ rows, currencyCode, costWarning, salesAvailable, generatedAt }: PurchaseAssistantProps) {
  const [values, setValues] = useState(defaults);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editsReset, setEditsReset] = useState(false);
  const inputs = useMemo(() => planningInputs(values), [values]);
  const now = useMemo(() => new Date(generatedAt), [generatedAt]);
  const planningRows = useMemo(() => salesAvailable ? rows : rows.map((row) => ({ ...row, units30Days: null, units60Days: null })), [rows, salesAvailable]);
  const baseline = useMemo(() => buildPurchasePlan(planningRows, currencyCode, { ...inputs, delayDays: 0, demandChangePercent: 0 }, now), [planningRows, currencyCode, inputs, now]);
  const scenario = useMemo(() => buildPurchasePlan(planningRows, currencyCode, inputs, now, edits), [planningRows, currencyCode, inputs, now, edits]);
  const noSales = useMemo(() => summarizeNoSalesStock(rows, currencyCode, salesAvailable, now), [rows, currencyCode, salesAvailable, now]);

  const updateValue = (name: keyof typeof defaults, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
    if (Object.keys(edits).length > 0) setEditsReset(true);
    setEdits({});
  };
  const download = () => {
    const csv = purchasePlanCsv(scenario);
    if (!csv) return;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "stockpulse-buying-list.csv";
    document.body.append(anchor);
    try { anchor.click(); } finally { anchor.remove(); URL.revokeObjectURL(url); }
  };

  return (
    <section aria-label="Purchase workspace" className={styles.workspace}>
      <div className={styles.card}>
        <h2>Purchase planner</h2>
        <p className={styles.muted}>Set local assumptions to create a reviewable buying list. This is an urgency heuristic, not a forecast or order.</p>
        {costWarning ? <s-banner tone="warning">{costWarning}</s-banner> : null}
        {!salesAvailable ? <s-banner tone="warning">Sales data is unavailable, so buying quantities cannot be calculated. Variants remain available for inspection below.</s-banner> : null}
        <div className={styles.fields}>
          <label className={styles.field}>Purchasing budget ({currencyCode ?? "unknown currency"})<input aria-label={`Purchasing budget (${currencyCode ?? "unknown currency"})`} inputMode="decimal" value={values.budget} onChange={(event) => updateValue("budget", event.currentTarget.value)} /></label>
          <label className={styles.field}>Lead time (days)<input aria-label="Lead time (days)" inputMode="numeric" value={values.leadTimeDays} onChange={(event) => updateValue("leadTimeDays", event.currentTarget.value)} /></label>
          <label className={styles.field}>Target cover after arrival (days)<input aria-label="Target cover after arrival (days)" inputMode="numeric" value={values.targetCoverDays} onChange={(event) => updateValue("targetCoverDays", event.currentTarget.value)} /></label>
        </div>
        {editsReset ? <p className={styles.notice} role="status">Quantity edits were reset because assumptions changed.</p> : null}
        {scenario.errors.length > 0 ? <div className={styles.errors} role="alert">{scenario.errors.map((error) => <p key={error}>{error}</p>)}</div> : null}
        <div className={styles.summaryGrid}>
          <div><span>Selected cost</span><strong>{amount(scenario.totalCostMinor, currencyCode)}</strong></div>
          <div><span>Remaining budget</span><strong>{amount(scenario.remainingBudgetMinor, currencyCode)}</strong></div>
          <div><span>Unfilled units</span><strong>{scenario.unfilledUnits}</strong></div>
          <div><span>Stockouts before delivery</span><strong>{scenario.stockoutsBeforeDelivery}</strong></div>
        </div>
        <PurchasePlanTable plan={scenario} edits={edits} onEdit={(variantId, value) => setEdits((current) => ({ ...current, [variantId]: value }))} />
        <button type="button" onClick={download} disabled={!scenario.exportable}>Download buying list CSV</button>
        <p className={styles.muted}>Selected cost uses current unit costs only; it excludes shipping, taxes, and supplier quote changes.</p>
      </div>
      <div className={styles.card}>
        <h2>What-if comparison</h2>
        <p className={styles.muted}>Scenario assumptions are not forecasts. They use the same budget and allocation method as the baseline.</p>
        <div className={styles.fields}>
          <label className={styles.field}>Extra delivery delay (days)<input aria-label="Extra delivery delay (days)" inputMode="numeric" value={values.delayDays} onChange={(event) => updateValue("delayDays", event.currentTarget.value)} /></label>
          <label className={styles.field}>Demand change (%)<input aria-label="Demand change (%)" inputMode="numeric" value={values.demandChangePercent} onChange={(event) => updateValue("demandChangePercent", event.currentTarget.value)} /></label>
        </div>
        <div className={styles.tableScroll}><table className={`${styles.table} ${styles.comparisonTable}`}><caption>Baseline and scenario assumptions</caption><thead><tr><th scope="col">Measure</th><th scope="col">Baseline</th><th scope="col">Scenario</th></tr></thead><tbody>
          <tr><th scope="row">Stockouts before delivery</th><td>{baseline.stockoutsBeforeDelivery}</td><td>{scenario.stockoutsBeforeDelivery}</td></tr>
          <tr><th scope="row">Needed units</th><td>{baseline.neededUnits}</td><td>{scenario.neededUnits}</td></tr>
          <tr><th scope="row">Selected cost</th><td>{amount(baseline.totalCostMinor, currencyCode)}</td><td>{amount(scenario.totalCostMinor, currencyCode)}</td></tr>
          <tr><th scope="row">Unfilled units</th><td>{baseline.unfilledUnits}</td><td>{scenario.unfilledUnits}</td></tr>
        </tbody></table></div>
      </div>
      <div className={styles.card}>
        <h2>Cost in no-sales stock</h2>
        <p className={styles.muted}>Current inventory cost for tracked, non-gift-card variants with positive stock, at least 60 days of known age, and zero observed 60-day sales. It is not cash, profit, loss, or historical acquisition cost.</p>
        <NoSalesStock summary={noSales} />
      </div>
    </section>
  );
}
