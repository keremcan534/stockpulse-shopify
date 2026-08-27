import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";

import { InventoryDashboard } from "./inventory-dashboard";
import type { InventoryRow } from "./inventory.types";

const rows: InventoryRow[] = [
  {
    variantId: "1",
    productTitle: "T-shirt",
    variantTitle: "Blue / M",
    sku: "BLUE-M",
    tracked: true,
    availableInventory: 4,
    createdAt: "2026-01-01T00:00:00.000Z",
    productStatus: "ACTIVE",
    isGiftCard: false,
    unitCost: null,
    units30Days: 30,
    units60Days: 45,
    averageDailySales: 1,
    daysOfStock: 4,
    reorderQuantity: 26,
    status: "low-stock",
  },
  {
    variantId: "2",
    productTitle: "Old cap",
    variantTitle: "Default",
    sku: "CAP-OLD",
    tracked: true,
    availableInventory: 8,
    createdAt: "2026-01-01T00:00:00.000Z",
    productStatus: "ACTIVE",
    isGiftCard: false,
    unitCost: null,
    units30Days: 0,
    units60Days: 0,
    averageDailySales: 0,
    daysOfStock: null,
    reorderQuantity: 0,
    status: "dead-stock",
  },
];

function renderDashboard(
  overrides: Partial<ComponentProps<typeof InventoryDashboard>> = {},
) {
  return render(
    <InventoryDashboard
      rows={rows}
      summary={{ tracked: 2, lowOrOut: 1, dead: 1 }}
      warning={null}
      costWarning={null}
      currencyCode="USD"
      salesAvailable={true}
      generatedAt="2026-08-26T09:00:00.000Z"
      {...overrides}
    />,
  );
}

describe("InventoryDashboard", () => {
  it("shows tracked, low-stock, and dead-stock summary counts", () => {
    renderDashboard();

    expect(screen.getByText("2 tracked variants")).toBeInTheDocument();
    expect(screen.getByText("1 low or out of stock")).toBeInTheDocument();
    expect(screen.getByText("1 dead stock")).toBeInTheDocument();
  });

  it("renders inventory metrics and an em dash for unavailable days", () => {
    renderDashboard();

    expect(screen.getByText("BLUE-M")).toBeInTheDocument();
    expect(screen.getByText("26")).toBeInTheDocument();
    expect(screen.getByText("4.0")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("filters rows by case-insensitive search text", async () => {
    const user = userEvent.setup();
    renderDashboard();

    await user.type(screen.getByLabelText("Search inventory"), "cap-old");

    expect(screen.getByText("Old cap")).toBeInTheDocument();
    expect(screen.queryByText("T-shirt")).not.toBeInTheDocument();
  });

  it("filters rows by inventory status", async () => {
    const user = userEvent.setup();
    renderDashboard();

    await user.selectOptions(
      screen.getByLabelText("Inventory status"),
      "dead-stock",
    );

    expect(screen.getByText("Old cap")).toBeInTheDocument();
    expect(screen.queryByText("T-shirt")).not.toBeInTheDocument();
  });

  it("distinguishes a store with no variants from filters with no matches", async () => {
    const user = userEvent.setup();
    const { unmount } = renderDashboard({
      rows: [],
      summary: { tracked: 0, lowOrOut: 0, dead: 0 },
    });

    expect(screen.getByText("No product variants found")).toBeInTheDocument();
    unmount();

    renderDashboard();
    await user.type(screen.getByLabelText("Search inventory"), "missing");
    expect(
      screen.getByText("No inventory matches these filters"),
    ).toBeInTheDocument();
  });

  it("keeps inventory visible while showing a sales-history warning", () => {
    renderDashboard({
      warning:
        "Sales history is temporarily unavailable. Sales-based metrics are hidden.",
    });

    expect(
      screen.getByText(
        "Sales history is temporarily unavailable. Sales-based metrics are hidden.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("T-shirt")).toBeInTheDocument();
  });

  it("shows sales-derived cells as unavailable when the loader returns partial data", () => {
    renderDashboard({
      rows: [
        {
          ...rows[0],
          units30Days: null,
          units60Days: null,
          averageDailySales: null,
          daysOfStock: null,
          reorderQuantity: null,
          status: "healthy",
        },
      ],
      summary: { tracked: 1, lowOrOut: 0, dead: 0 },
    });

    expect(screen.getAllByText("—")).toHaveLength(4);
  });

  it("renders the generated timestamp in a deterministic UTC timezone", () => {
    renderDashboard();

    expect(
      screen.getByText(/Updated Aug 26, 2026, 9:00 AM UTC\./),
    ).toBeInTheDocument();
  });
});
