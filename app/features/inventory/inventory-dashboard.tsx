import { useMemo, useState } from "react";

import { filterInventoryRows } from "./inventory-metrics";
import type {
  InventoryDashboardData,
  InventoryStatus,
} from "./inventory.types";
import styles from "./inventory-dashboard.module.css";
import { PurchaseAssistant } from "./purchase-assistant";

const statusLabels: Record<InventoryStatus, string> = {
  "not-tracked": "Not tracked",
  "out-of-stock": "Out of stock",
  "dead-stock": "Dead stock",
  "insufficient-history": "Insufficient history",
  unavailable: "Sales unavailable",
  "low-stock": "Low stock",
  healthy: "Healthy",
};

const statusTones: Record<
  InventoryStatus,
  "neutral" | "critical" | "warning" | "caution" | "success"
> = {
  "not-tracked": "neutral",
  "out-of-stock": "critical",
  "dead-stock": "warning",
  "insufficient-history": "caution",
  unavailable: "neutral",
  "low-stock": "caution",
  healthy: "success",
};

const timestampFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

function formatInteger(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("en-US").format(value);
}

function formatDecimal(value: number | null, digits: number): string {
  return value === null ? "—" : value.toFixed(digits);
}

function SummaryCard({ value, label }: { value: number; label: string }) {
  return (
    <div className={styles.summaryCard}>
      <p className={styles.summaryValue}>{value}</p>
      <p className={styles.summaryLabel}>{`${value} ${label}`}</p>
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className={styles.emptyState}>
      <s-icon type={filtered ? "search" : "inventory"} size="base" />
      <h2>
        {filtered
          ? "No inventory matches these filters"
          : "No product variants found"}
      </h2>
      <p className={styles.muted}>
        {filtered
          ? "Try a different search term or inventory status."
          : "Add products in Shopify Admin, then return here to see inventory health."}
      </p>
    </div>
  );
}

export function InventoryDashboard({
  rows,
  summary,
  warning,
  costWarning,
  generatedAt,
  currencyCode,
  salesAvailable,
}: InventoryDashboardData) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<InventoryStatus | "all">("all");
  const filteredRows = useMemo(
    () => filterInventoryRows(rows, { query, status }),
    [query, rows, status],
  );
  const hasFilters = query.trim().length > 0 || status !== "all";

  return (
    <s-page heading="StockPulse inventory">
      <PurchaseAssistant rows={rows} currencyCode={currencyCode} costWarning={costWarning} salesAvailable={salesAvailable} generatedAt={generatedAt} />
      <s-section>
        <section aria-label="Inventory list"><s-stack direction="block" gap="base">
          <s-heading>Inventory health at a glance</s-heading>
          <p className={styles.intro}>
            Prioritize stock using observed 30-day sales. Dead stock requires a
            known age of at least 60 days and no observed sales; variants without
            enough age history do not receive estimates.
          </p>

          {warning ? <s-banner tone="warning">{warning}</s-banner> : null}

          <div className={styles.summaryGrid}>
            <SummaryCard value={summary.tracked} label="tracked variants" />
            <SummaryCard
              value={summary.lowOrOut}
              label="low or out of stock"
            />
            <SummaryCard value={summary.dead} label="dead stock" />
          </div>

          <div className={styles.controls}>
            <div className={styles.field}>
              <label htmlFor="inventory-search">Search inventory</label>
              <input
                id="inventory-search"
                type="search"
                value={query}
                placeholder="Product, variant, or SKU"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="inventory-status">Inventory status</label>
              <select
                id="inventory-status"
                value={status}
                onChange={(event) =>
                  setStatus(event.currentTarget.value as InventoryStatus | "all")
                }
              >
                <option value="all">All statuses</option>
                <option value="low-stock">Low stock</option>
                <option value="out-of-stock">Out of stock</option>
                <option value="dead-stock">Dead stock</option>
                <option value="insufficient-history">Insufficient history</option>
                <option value="unavailable">Sales unavailable</option>
                <option value="healthy">Healthy</option>
                <option value="not-tracked">Not tracked</option>
              </select>
            </div>
          </div>

          {rows.length === 0 || filteredRows.length === 0 ? (
            <EmptyState filtered={rows.length > 0 && hasFilters} />
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Product / Variant</s-table-header>
                <s-table-header listSlot="secondary">SKU</s-table-header>
                <s-table-header format="numeric">Available</s-table-header>
                <s-table-header format="numeric">30-day sales</s-table-header>
                <s-table-header format="numeric">Daily sales</s-table-header>
                <s-table-header format="numeric">Days of stock</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header format="numeric">Reorder</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {filteredRows.map((row) => (
                  <s-table-row key={row.variantId}>
                    <s-table-cell>
                      <div className={styles.productCell}>
                        <span className={styles.productTitle}>
                          {row.productTitle}
                        </span>
                        <span className={styles.variantTitle}>
                          {row.variantTitle}
                        </span>
                      </div>
                    </s-table-cell>
                    <s-table-cell>{row.sku ?? "—"}</s-table-cell>
                    <s-table-cell>{formatInteger(row.availableInventory)}</s-table-cell>
                    <s-table-cell>{formatInteger(row.units30Days)}</s-table-cell>
                    <s-table-cell>
                      {formatDecimal(row.averageDailySales, 2)}
                    </s-table-cell>
                    <s-table-cell>{formatDecimal(row.daysOfStock, 1)}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={statusTones[row.status]}>
                        {statusLabels[row.status]}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>{formatInteger(row.reorderQuantity)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}

          <p className={styles.footer}>
            Updated {timestampFormatter.format(new Date(generatedAt))} UTC.{" "}
            Reorder recommendations are advisory and never change Shopify
            inventory.
          </p>
        </s-stack></section>
      </s-section>
    </s-page>
  );
}
