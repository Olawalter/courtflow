import { cn } from "@/lib/utils";
import type { AgreementStatus, DisputeStatus, JudgmentDecision } from "@/lib/genlayer/types";

type Status = AgreementStatus | DisputeStatus | JudgmentDecision | string;

const TONE: Record<string, string> = {
  DRAFT: "text-muted-foreground border-border",
  ACTIVE: "text-primary border-primary/40",
  FUNDED: "text-primary border-primary/40",
  DELIVERED: "text-primary border-primary/40",
  APPROVED: "text-success border-success/40",
  DISPUTED: "text-dispute border-dispute/40",
  OPEN: "text-dispute border-dispute/40",
  UNDER_REVIEW: "text-consensus border-consensus/40",
  JUDGED: "text-consensus border-consensus/40",
  SETTLED: "text-success border-success/40",
  CANCELLED: "text-muted-foreground border-border",
  TIMED_OUT: "text-warning border-warning/40",
  FULFILLED: "text-success border-success/40",
  FAILED: "text-dispute border-dispute/40",
  PARTIAL: "text-warning border-warning/40",
  INSUFFICIENT_EVIDENCE: "text-success border-success/40",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        TONE[status] ?? "text-muted-foreground border-border"
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}
