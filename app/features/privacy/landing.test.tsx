import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, type LoaderFunctionArgs } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../shopify.server", () => ({ login: () => undefined }));
import Landing, { loader } from "../../routes/_index/route";

afterEach(cleanup);
it("offers the demo and data notice while preserving the shop login form", async () => {
  const data = await loader({ request: new Request("https://stockpulse.example/") } as LoaderFunctionArgs);
  // Supply server hydration data: jsdom's AbortSignal is not Node fetch's signal.
  const router = createMemoryRouter([{ id: "landing", path: "/", Component: Landing, loader }], {
    hydrationData: { loaderData: { landing: data } },
  });
  render(<RouterProvider router={router} />);
  expect(await screen.findByRole("heading", { name: /StockPulse/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Try the sample demo/ })).toHaveAttribute("href", "/demo");
  expect(screen.getByRole("link", { name: /Data use/ })).toHaveAttribute("href", "/privacy");
  expect(screen.getByRole("button", { name: "Log in" }).closest("form")).toHaveAttribute("action", "/auth/login");
});
it("preserves embedded launch parameters when redirecting a shop request", async () => {
  const args = { request: new Request("https://stockpulse.example/?shop=alpha.myshopify.com&host=sample&embedded=1") } as LoaderFunctionArgs;
  await expect(loader(args)).rejects.toMatchObject({ status: 302 });
  try { await loader(args); } catch (error) {
    expect((error as Response).headers.get("location")).toBe("/app?shop=alpha.myshopify.com&host=sample&embedded=1");
  }
});
