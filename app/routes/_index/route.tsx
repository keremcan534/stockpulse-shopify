import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>StockPulse: know what to restock next</h1>
        <p className={styles.text}>
          Review low stock, days of stock, and a buying list that fits your budget.
          A read-only Shopify inventory assistant in private pilot development.
        </p>
        <nav aria-label="Product preview">
          <a href="/demo">Try the sample demo</a>{" · "}
          <a href="/privacy">Data use</a>
        </nav>
        <p>No account or payment is needed for the sample demo. Store login below is for an already configured development installation.</p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Spot stock risks</strong>. Review low-stock and out-of-stock
            variants with coverage estimates based on observed sales.
          </li>
          <li>
            <strong>Plan within a budget</strong>. Adjust quantities, compare
            delivery-delay scenarios, and export a buying list for review.
          </li>
          <li>
            <strong>Review no-sales stock</strong>. See current costs in older
            stocked variants with no observed sales. No automatic orders or inventory changes.
          </li>
        </ul>
      </div>
    </div>
  );
}
