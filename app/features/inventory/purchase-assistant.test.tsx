import "@testing-library/jest-dom/vitest";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PurchaseAssistant } from "./purchase-assistant";
import type { InventoryRow } from "./inventory.types";

const rows: InventoryRow[] = [
  {
    variantId: "old-blue",
    productTitle: "Old blue shirt",
    variantTitle: "Medium",
    sku: "BLUE-M",
    tracked: true,
    availableInventory: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    productStatus: "ACTIVE",
    isGiftCard: false,
    unitCost: { amount: "5.00", currencyCode: "USD" },
    units30Days: 30,
    units60Days: 45,
    averageDailySales: 1,
    daysOfStock: 2,
    reorderQuantity: 28,
    status: "low-stock",
  },
];

const fixture = {
  rows,
  currencyCode: "USD",
  costWarning: null,
  salesAvailable: true,
  generatedAt: "2026-08-26T09:00:00.000Z",
};

describe("PurchaseAssistant", () => {
  it("renders an eligible plan and updates it when the purchasing budget changes", async () => {
    const user = userEvent.setup();
    render(<PurchaseAssistant {...fixture} />);

    expect(screen.getByRole("heading", { name: "Purchase planner" })).toBeInTheDocument();
    expect(screen.getByText("Old blue shirt")).toBeInTheDocument();
    expect(screen.getAllByText("$175.00 USD").length).toBeGreaterThan(0);

    await user.clear(screen.getByLabelText(/Purchasing budget/));
    await user.type(screen.getByLabelText(/Purchasing budget/), "10");

    expect(screen.getAllByText("$10.00 USD").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Download buying list CSV" })).toBeEnabled();
  });

  it("compares a demand and delivery scenario against the fixed baseline", async () => {
    const user = userEvent.setup();
    render(<PurchaseAssistant {...fixture} />);

    await user.clear(screen.getByLabelText("Extra delivery delay (days)"));
    await user.type(screen.getByLabelText("Extra delivery delay (days)"), "7");
    await user.clear(screen.getByLabelText("Demand change (%)"));
    await user.type(screen.getByLabelText("Demand change (%)"), "30");

    const comparison = within(screen.getByRole("table", { name: "Baseline and scenario assumptions" }));
    expect(comparison.getByText("35")).toBeInTheDocument();
    expect(comparison.getByText("56")).toBeInTheDocument();
  });

  it("resets quantity edits when assumptions change", async () => {
    const user = userEvent.setup();
    render(<PurchaseAssistant {...fixture} />);
    const quantity = screen.getByLabelText(/Selected quantity for Old blue shirt/);

    await user.clear(quantity);
    await user.type(quantity, "1");
    expect(quantity).toHaveValue(1);
    await user.clear(screen.getByLabelText("Lead time (days)"));
    await user.type(screen.getByLabelText("Lead time (days)"), "8");

    expect(screen.getByRole("status")).toHaveTextContent("Quantity edits were reset");
    expect(screen.getByLabelText(/Selected quantity for Old blue shirt/)).toHaveValue(36);
  });

  it("disables CSV for blank and over-budget edits", async () => {
    const user = userEvent.setup();
    render(<PurchaseAssistant {...fixture} />);
    const exportButton = screen.getByRole("button", { name: "Download buying list CSV" });

    await user.clear(screen.getByLabelText(/Purchasing budget/));
    expect(exportButton).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Budget must be");

    await user.type(screen.getByLabelText(/Purchasing budget/), "10");
    await user.clear(screen.getByLabelText(/Selected quantity for Old blue shirt/));
    await user.type(screen.getByLabelText(/Selected quantity for Old blue shirt/), "35");
    expect(exportButton).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("exceed the purchase budget");
  });

  it("rejects invalid numeric input without creating a download", async () => {
    const user = userEvent.setup();
    const BlobConstructor = Blob;
    const blob = vi.fn(function (this: Blob, parts?: BlobPart[], options?: BlobPropertyBag) {
      return new BlobConstructor(parts, options);
    });
    const createObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.stubGlobal("Blob", blob);
    vi.stubGlobal("URL", { createObjectURL });
    render(<PurchaseAssistant {...fixture} />);
    const exportButton = screen.getByRole("button", { name: "Download buying list CSV" });

    await user.clear(screen.getByLabelText("Lead time (days)"));
    await user.type(screen.getByLabelText("Lead time (days)"), "one");
    await user.click(exportButton);

    expect(screen.getByRole("alert")).toHaveTextContent("Lead time must be a whole number");
    expect(exportButton).toBeDisabled();
    expect(blob).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it("updates selected totals when an editable quantity changes", async () => {
    const user = userEvent.setup();
    render(<PurchaseAssistant {...fixture} />);

    await user.clear(screen.getByLabelText(/Selected quantity for Old blue shirt/));
    await user.type(screen.getByLabelText(/Selected quantity for Old blue shirt/), "1");

    const planner = within(screen.getByRole("heading", { name: "Purchase planner" }).parentElement!);
    expect(planner.getByText("Selected cost").parentElement).toHaveTextContent("$5.00 USD");
    expect(planner.getByText("Remaining budget").parentElement).toHaveTextContent("$995.00 USD");
  });

  it("shows missing-cost coverage for qualifying no-sales stock", () => {
    render(<PurchaseAssistant {...fixture} rows={[{ ...rows[0], units30Days: 0, units60Days: 0, unitCost: null }]} costWarning="Cost access is unavailable." />);

    expect(screen.getByText("Cost access is unavailable.")).toBeInTheDocument();
    expect(screen.getByText(/1 missing-cost variant/)).toBeInTheDocument();
    expect(screen.getByText("Unknown USD")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Old blue shirt — Medium · BLUE-M");
  });

  it("does not classify a new zero-sales item as no-sales stock", () => {
    render(<PurchaseAssistant {...fixture} rows={[{ ...rows[0], createdAt: "2026-08-20T00:00:00.000Z", units30Days: 0, units60Days: 0 }]} />);

    expect(screen.getByText(/New items need at least 60 days/)).toBeInTheDocument();
  });

  it("explains the empty buying list when observed sales are zero", () => {
    render(<PurchaseAssistant {...fixture} rows={[{ ...rows[0], units30Days: 0, units60Days: 0 }]} />);

    expect(screen.getByText(/No buying suggestions are available/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Selected quantity/)).not.toBeInTheDocument();
  });

  it("keeps normal null sales data out of purchase quantities", () => {
    render(<PurchaseAssistant {...fixture} rows={[{ ...rows[0], units30Days: null, units60Days: null }]} />);

    expect(screen.getByText("Old blue shirt")).toBeInTheDocument();
    expect(screen.getByText(/30-day sales data is unavailable/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Selected quantity/)).not.toBeInTheDocument();
  });

  it("keeps stale sales rows inspectable but never calculates quantities when sales are unavailable", () => {
    render(<PurchaseAssistant {...fixture} salesAvailable={false} />);

    expect(screen.getByText(/Sales data is unavailable/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Selected quantity/)).not.toBeInTheDocument();
    expect(screen.getByText("Old blue shirt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download buying list CSV" })).toBeDisabled();
  });

  it("downloads real CSV through the Blob object URL boundary and revokes it", async () => {
    const user = userEvent.setup();
    const objectUrl = "blob:stockpulse";
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return objectUrl;
    });
    const revokeObjectURL = vi.fn();
    const downloads: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    render(<PurchaseAssistant {...fixture} />);

    await user.click(screen.getByRole("button", { name: "Download buying list CSV" }));

    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = blobs[0]!;
    const reader = new FileReader();
    const contents = await new Promise<string>((resolve, reject) => {
      reader.addEventListener("load", () => resolve(String(reader.result)));
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsText(blob);
    });
    expect(contents).toContain('"BLUE-M"');
    expect(click).toHaveBeenCalledOnce();
    expect(downloads).toEqual(["stockpulse-buying-list.csv"]);
    expect(revokeObjectURL).toHaveBeenCalledWith(objectUrl);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
