import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgreementStatus } from "@/lib/genlayer/types";

const HAPPY_PATH: { label: string; statuses: AgreementStatus[] }[] = [
  { label: "Agreement Created", statuses: ["DRAFT", "ACTIVE", "FUNDED", "DELIVERED", "APPROVED", "DISPUTED", "UNDER_REVIEW", "JUDGED", "SETTLED"] },
  { label: "Accepted", statuses: ["ACTIVE", "FUNDED", "DELIVERED", "APPROVED", "DISPUTED", "UNDER_REVIEW", "JUDGED", "SETTLED"] },
  { label: "Escrow Funded", statuses: ["FUNDED", "DELIVERED", "APPROVED", "DISPUTED", "UNDER_REVIEW", "JUDGED", "SETTLED"] },
  { label: "Delivery Submitted", statuses: ["DELIVERED", "APPROVED", "DISPUTED", "UNDER_REVIEW", "JUDGED", "SETTLED"] },
  { label: "Buyer Review", statuses: ["DELIVERED", "DISPUTED", "UNDER_REVIEW", "JUDGED"] },
  { label: "Settlement", statuses: ["APPROVED", "SETTLED"] },
];

const TERMINAL_NON_HAPPY: AgreementStatus[] = ["CANCELLED", "TIMED_OUT"];

export function LifecycleTracker({ status }: { status: AgreementStatus }) {
  if (TERMINAL_NON_HAPPY.includes(status)) {
    return (
      <div className="rounded-md border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-warning">
        This agreement ended as <strong>{status.replaceAll("_", " ")}</strong> before
        completing the normal lifecycle.
      </div>
    );
  }

  const isSettled = status === "SETTLED";
  const activeIndex = HAPPY_PATH.findIndex(
    (step, i) => step.statuses.includes(status) && (i === HAPPY_PATH.length - 1 || !isSettled)
  );

  return (
    <ol className="flex flex-col gap-2">
      {HAPPY_PATH.map((step, i) => {
        const reached = step.statuses.includes(status) || isSettled;
        const current = !isSettled && i === activeIndex;
        return (
          <li key={step.label} className="flex items-center gap-3 text-sm">
            {reached && !current ? (
              <Check size={16} className="text-success shrink-0" />
            ) : current ? (
              <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                <span className="absolute h-4 w-4 rounded-full bg-primary/30 animate-ping" />
                <span className="h-2 w-2 rounded-full bg-primary" />
              </span>
            ) : (
              <Circle size={16} className="text-border shrink-0" />
            )}
            <span
              className={cn(
                reached ? "text-foreground" : "text-muted-foreground",
                current && "font-medium"
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
