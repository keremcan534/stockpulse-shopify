import { formatMoneyMinor } from "./planning-money";
import type { NoSalesStockSummary } from "./purchase-planning";
import styles from "./purchase-assistant.module.css";

export function NoSalesStock({ summary }: { summary: NoSalesStockSummary }) {
  if (!summary.salesAvailable) {
    return <p className={styles.emptyCopy}>No-sales stock is unknown because 60-day sales data is unavailable.</p>;
  }

  if (summary.qualifyingVariants === 0) {
    return (
      <>
        <p className={styles.summaryLine}>
          Current cost: <strong>{formatMoneyMinor(0, summary.currencyCode)} {summary.currencyCode ?? ""}</strong>
        </p>
        <p className={styles.emptyCopy}>No qualifying no-sales stock. New items need at least 60 days of known age before this check applies.</p>
      </>
    );
  }

  return (
    <>
      <p className={styles.summaryLine}>
        Current cost: <strong>{formatMoneyMinor(summary.totalCostMinor, summary.currencyCode)} {summary.currencyCode ?? ""}</strong>
      </p>
      <p className={styles.muted}>
        {summary.knownCostVariants} cost-known variant(s), {summary.missingCostVariants} missing-cost variant(s); {summary.knownCostUnits} known-cost units and {summary.missingCostUnits} missing-cost units.
      </p>
      <details className={styles.excluded}>
        <summary>Qualifying no-sales variants ({summary.qualifyingVariants})</summary>
        <ul>
          {summary.rows.map((row) => (
            <li key={row.variantId}>
              <strong>{row.productTitle}</strong> — {row.variantTitle} · {row.sku ?? "SKU not provided"} ({row.units} units): Unit cost: {formatMoneyMinor(row.costMinor, summary.currencyCode)} {summary.currencyCode ?? ""}; Extended total: {formatMoneyMinor(row.costMinor === null ? null : row.costMinor * row.units, summary.currencyCode)} {summary.currencyCode ?? ""}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
