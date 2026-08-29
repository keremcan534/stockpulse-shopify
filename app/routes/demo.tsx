import { PurchaseAssistant } from "../features/inventory/purchase-assistant";
import { calculateInventoryRows } from "../features/inventory/inventory-metrics";
import type { CatalogVariant } from "../features/inventory/inventory.types";
import styles from "../features/privacy/pilot.module.css";

// Deliberately synthetic and fixed: never loaded from or written to a store.
const generatedAt = "2026-08-29T12:00:00Z";
const catalog: CatalogVariant[] = [
  { variantId: "sample-bottle", productTitle: "Sample insulated bottle", variantTitle: "Blue", sku: "DEMO-001", tracked: true, availableInventory: 8, createdAt: "2026-01-01T00:00:00Z", productStatus: "ACTIVE", isGiftCard: false, unitCost: { amount: "12.50", currencyCode: "USD" } },
  { variantId: "sample-tote", productTitle: "Sample canvas tote", variantTitle: "Natural", sku: "DEMO-002", tracked: true, availableInventory: 0, createdAt: "2026-01-01T00:00:00Z", productStatus: "ACTIVE", isGiftCard: false, unitCost: { amount: "6.00", currencyCode: "USD" } },
  { variantId: "sample-mug", productTitle: "Sample seasonal mug", variantTitle: "Winter", sku: "DEMO-003", tracked: true, availableInventory: 40, createdAt: "2026-01-01T00:00:00Z", productStatus: "ACTIVE", isGiftCard: false, unitCost: { amount: "8.00", currencyCode: "USD" } },
];
const rows = calculateInventoryRows(catalog, [
  { variantId: "sample-bottle", units30Days: 60, units60Days: 120 },
  { variantId: "sample-tote", units30Days: 30, units60Days: 60 },
  { variantId: "sample-mug", units30Days: 0, units60Days: 0 },
], true, new Date(generatedAt));

export default function Demo() {
  return <main className={styles.page}>
    <nav className={styles.nav} aria-label="Public pages"><a href="/">StockPulse</a><a href="/privacy">Data use</a></nav>
    <header>
      <p className={styles.eyebrow}>INTERACTIVE PRODUCT PREVIEW</p>
      <h1>StockPulse sample demo</h1>
      <p>Illustrative sample data — not connected to a real store. No account, payment, or store access is needed.</p>
      <p>Try a smaller purchasing budget, then add a delivery delay. See which buying quantities fit and which products have no observed sales.</p>
      <p className={styles.notice}>Nothing here places orders or changes inventory. Inputs stay in this page; a refresh resets them. Downloaded CSV files contain sample products only.</p>
    </header>
    <PurchaseAssistant rows={rows} currencyCode="USD" costWarning={null} salesAvailable generatedAt={generatedAt} />
    <footer>Private pilot preview, not a published App Store service. Share feedback with the person who invited you.</footer>
  </main>;
}
