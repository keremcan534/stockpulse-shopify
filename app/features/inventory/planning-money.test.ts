import { describe, expect, it } from "vitest";

import {
  currencyDigits,
  formatMoneyMinor,
  parseMoneyMinor,
} from "./planning-money";

describe("currency-aware money parsing", () => {
  it("converts valid decimal strings using the currency fraction digits", () => {
    expect(parseMoneyMinor("0.29", "USD")).toBe(29);
    expect(parseMoneyMinor("1.234", "KWD")).toBe(1234);
    expect(parseMoneyMinor("120", "JPY")).toBe(120);
  });

  it("rounds a fractional cost minor unit upward without rounding budgets", () => {
    expect(parseMoneyMinor("1.001", "USD", true)).toBe(101);
    expect(parseMoneyMinor("1.001", "USD")).toBeNull();
    expect(parseMoneyMinor("2.000", "USD", true)).toBe(200);
    expect(parseMoneyMinor("120.0", "JPY", true)).toBe(120);
  });

  it.each(["", " ", "-1", "+1", "1e3", "Infinity", "NaN", ".5", "1."])(
    "rejects unsafe monetary syntax %j",
    (value) => {
      expect(parseMoneyMinor(value, "USD")).toBeNull();
    },
  );

  it("rejects invalid currencies and unsafe minor-unit values", () => {
    expect(currencyDigits("not-a-currency")).toBeNull();
    expect(currencyDigits("ZZZ")).toBeNull();
    expect(parseMoneyMinor("90071992547410", "USD")).toBeNull();
  });

  it("formats valid minor values and never invents a value for unknown money", () => {
    expect(formatMoneyMinor(1234, "USD")).toBe("$12.34");
    expect(formatMoneyMinor(null, "USD")).toBe("Unknown");
    expect(formatMoneyMinor(1234, "not-a-currency")).toBe("Unknown");
  });
});
