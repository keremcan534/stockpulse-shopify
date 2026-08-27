import type { ChangeEvent } from "react";

import { formatMoneyMinor } from "./planning-money";
import type { PurchasePlan } from "./purchase-planning";
import styles from "./purchase-assistant.module.css";

function productLabel(productTitle: string, variantTitle: string, sku: string | null): string {
  return `${productTitle}, ${variantTitle}${sku ? `, SKU ${sku}` : ""}`;
}

export function PurchasePlanTable({
  plan,
  edits,
  onEdit,
}: {
  plan: PurchasePlan;
  edits: Record<string, string>;
  onEdit: (variantId: string, value: string) => void;
}) {
  const buyRows = plan.rows.filter((row) => row.action === "buy" || row.action === "defer");
  const excludedRows = plan.rows.filter((row) => row.action === "check-data" || row.action === "no-purchase");

  const edit = (variantId: string) => (event: ChangeEvent<HTMLInputElement>) => {
    onEdit(variantId, event.currentTarget.value);
  };

  return (
    <>
      {buyRows.length === 0 ? (
        <p className={styles.emptyCopy}>
          No buying suggestions are available. This can be expected for a young store with no observed sales; StockPulse does not invent demand.
        </p>
      ) : <div className={styles.tableScroll}>
        <table className={styles.table}>
          <caption>Buying list based on the current assumptions</caption>
          <thead>
            <tr>
              <th scope="col">Product / variant</th>
              <th scope="col">Calculated need</th>
              <th scope="col">Selected quantity</th>
              <th scope="col">Unit cost</th>
              <th scope="col">Line cost</th>
              <th scope="col">Action</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {buyRows.map((row) => (
              <tr key={row.variantId}>
                <th scope="row">
                  <span>{row.productTitle}</span>
                  <small>{row.variantTitle}{row.sku ? ` · ${row.sku}` : ""}</small>
                </th>
                <td>{row.need}</td>
                <td>
                  <input
                    aria-label={`Selected quantity for ${productLabel(row.productTitle, row.variantTitle, row.sku)}`}
                    type="number"
                    min="0"
                    max={row.need}
                    step="1"
                    value={edits[row.variantId] ?? String(row.quantity)}
                    onChange={edit(row.variantId)}
                  />
                </td>
                <td>{formatMoneyMinor(row.unitCostMinor, plan.currencyCode)} {plan.currencyCode ?? ""}</td>
                <td>{formatMoneyMinor(row.lineCostMinor, plan.currencyCode)} {plan.currencyCode ?? ""}</td>
                <td>{row.action === "buy" ? "Buy now" : "Defer"}</td>
                <td>{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
      {excludedRows.length > 0 ? (
        <details className={styles.excluded}>
          <summary>Check data or no-purchase variants ({excludedRows.length})</summary>
          <ul>
            {excludedRows.map((row) => (
              <li key={row.variantId}>
                <strong>{row.productTitle}</strong> — {row.variantTitle}{row.sku ? ` · ${row.sku}` : ""}: {row.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
