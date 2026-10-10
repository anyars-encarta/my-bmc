import type { PaymentStatus } from "@/types/domain";

export function toTitleCase(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function paymentStatusTone(status: PaymentStatus) {
  switch (status) {
    case "completed":
      return "bg-emerald-500/15 text-emerald-700 border-emerald-500/30";
    case "approved":
      return "bg-sky-500/15 text-sky-700 border-sky-500/30";
    case "pending_approval":
      return "bg-amber-500/15 text-amber-700 border-amber-500/30";
    case "processing":
      return "bg-indigo-500/15 text-indigo-700 border-indigo-500/30";
    case "cancelled":
      return "bg-rose-500/15 text-rose-700 border-rose-500/30";
    default:
      return "bg-zinc-500/15 text-zinc-700 border-zinc-500/30";
  }
}
