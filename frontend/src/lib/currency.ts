export function formatCurrency(amount: string | number) {
  const value = typeof amount === "string" ? Number(amount) : amount;

  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    minimumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}
