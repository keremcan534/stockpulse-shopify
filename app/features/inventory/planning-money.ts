const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);
const supportedCurrencies = new Set(
  Intl.supportedValuesOf("currency"),
);

export function currencyDigits(currencyCode: string | null): number | null {
  if (!currencyCode || !/^[A-Za-z]{3}$/.test(currencyCode)) return null;
  const normalizedCurrency = currencyCode.toUpperCase();
  if (!supportedCurrencies.has(normalizedCurrency)) return null;

  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: normalizedCurrency,
    }).resolvedOptions().maximumFractionDigits ?? null;
  } catch {
    return null;
  }
}

export function parseMoneyMinor(
  value: string,
  currencyCode: string | null,
  roundUp = false,
): number | null {
  const digits = currencyDigits(currencyCode);
  if (digits === null || !/^\d+(?:\.\d+)?$/.test(value)) return null;

  const [wholeText, fractionText = ""] = value.split(".");
  const minorText = wholeText + fractionText.slice(0, digits).padEnd(digits, "0");
  let minor = BigInt(minorText || "0");
  const discarded = fractionText.slice(digits);
  if (discarded && !roundUp) {
    return null;
  }
  if (discarded && /[1-9]/.test(discarded)) minor += 1n;

  if (minor > MAX_SAFE_MINOR) return null;
  return Number(minor);
}

export function formatMoneyMinor(
  value: number | null,
  currencyCode: string | null,
): string {
  const digits = currencyDigits(currencyCode);
  if (
    value === null ||
    digits === null ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    return "Unknown";
  }

  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: currencyCode!,
    }).format(value / 10 ** digits);
  } catch {
    return "Unknown";
  }
}
