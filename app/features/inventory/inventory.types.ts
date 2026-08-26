export type InventoryStatus =
  | "not-tracked"
  | "out-of-stock"
  | "dead-stock"
  | "low-stock"
  | "healthy";

export interface CatalogVariant {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  tracked: boolean;
  availableInventory: number;
}

export interface VariantSales {
  variantId: string;
  units30Days: number;
  units60Days: number;
}

export interface InventoryRow extends CatalogVariant {
  units30Days: number | null;
  units60Days: number | null;
  averageDailySales: number | null;
  daysOfStock: number | null;
  reorderQuantity: number | null;
  status: InventoryStatus;
}

export interface InventorySummary {
  tracked: number;
  lowOrOut: number;
  dead: number;
}

export interface InventoryFilters {
  query: string;
  status: InventoryStatus | "all";
}

export interface InventoryDashboardData {
  rows: InventoryRow[];
  summary: InventorySummary;
  warning: string | null;
  generatedAt: string;
}
