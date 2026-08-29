import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import Demo from "../../routes/demo";
import Privacy from "../../routes/privacy";

afterEach(cleanup);

it("labels sample data and lets a visitor try the real planner without a Shopify account", async () => {
  render(<Demo />);
  expect(screen.getByRole("heading", { name: /sample demo/i })).toBeInTheDocument();
  expect(screen.getByText(/not connected to a real store/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Download buying list CSV/ })).toBeEnabled();
  const user = userEvent.setup();
  const budget = screen.getByRole("textbox", { name: "Purchasing budget (USD)" });
  await user.clear(budget);
  await user.type(budget, "invalid");
  expect(screen.getByRole("button", { name: /Download buying list CSV/ })).toBeDisabled();
  expect(screen.getByRole("link", { name: /data use/i })).toHaveAttribute("href", "/privacy");
});

it("discloses retained sessions, no retained customer records, and pilot limitations without collecting data", () => {
  render(<Privacy />);
  expect(screen.getByRole("heading", { name: /data use/i })).toBeInTheDocument();
  expect(screen.getByText(/access tokens/i)).toBeInTheDocument();
  expect(screen.getByText(/does not retain customer profiles/i)).toBeInTheDocument();
  expect(screen.getByText(/not a published App Store service/i)).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
