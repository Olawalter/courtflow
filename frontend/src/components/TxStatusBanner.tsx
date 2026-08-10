import { cn } from "@/lib/utils";
import { TX_STAGE_LABEL, type TxStage } from "@/lib/genlayer/useTxStatus";

export function TxStatusBanner({
  stage,
  hash,
  error,
}: {
  stage: TxStage;
  hash: string | null;
  error: string | null;
}) {
  if (stage === "idle") return null;

  const tone =
    stage === "finalized"
      ? "border-success/40 bg-success/5 text-success"
      : stage === "failed"
        ? "border-dispute/40 bg-dispute/5 text-dispute"
        : "border-primary/40 bg-primary/5 text-primary";

  return (
    <div className={cn("rounded-md border px-4 py-3 text-sm flex flex-col gap-1", tone)}>
      <div className="flex items-center gap-2">
        {stage !== "finalized" && stage !== "failed" && (
          <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
        )}
        <span className="font-medium">{TX_STAGE_LABEL[stage]}</span>
      </div>
      {hash && (
        <span className="text-xs text-muted-foreground break-all">
          tx: {hash}
        </span>
      )}
      {error && <span className="text-xs">{error}</span>}
    </div>
  );
}
