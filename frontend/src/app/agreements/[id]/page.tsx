"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { TopNav } from "@/components/TopNav";
import { DeploymentBanner } from "@/components/DeploymentBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { LifecycleTracker } from "@/components/agreement/LifecycleTracker";
import { TxStatusBanner } from "@/components/TxStatusBanner";
import { useAgreement } from "@/lib/genlayer/hooks";
import { useWallet } from "@/lib/genlayer/wallet";
import { writeCourtFlow, weiToGen } from "@/lib/genlayer/contract";
import { useTxStatus } from "@/lib/genlayer/useTxStatus";
import type { TransactionHash } from "genlayer-js/types";

function parseGenAmount(amount: number): bigint {
  // Contract escrow amounts are plain integers of GEN's smallest unit in this MVP.
  return BigInt(Math.trunc(amount));
}

export default function AgreementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: agreement, loading, error, deployed, refetch } = useAgreement(id);
  const client = useWallet((s) => s.client);
  const address = useWallet((s) => s.address);
  const tx = useTxStatus();
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [fileRefs, setFileRefs] = useState("ipfs://logo.png\nipfs://logo.svg\nipfs://logo-source.ai");
  const [deliveryMetadata, setDeliveryMetadata] = useState("Final logo delivery");

  const isBuyer = address && agreement && address.toLowerCase() === agreement.buyer.toLowerCase();
  const isProvider =
    address && agreement && address.toLowerCase() === agreement.provider.toLowerCase();

  async function run(action: string, fn: () => Promise<TransactionHash>) {
    setActiveAction(action);
    await tx.run(fn, () => {
      refetch();
      router.refresh();
    });
  }

  const busy = tx.stage !== "idle" && tx.stage !== "finalized" && tx.stage !== "failed";

  return (
    <div className="flex-1 flex flex-col">
      <TopNav />
      {!deployed && <DeploymentBanner />}

      <main className="flex-1 px-6 py-8">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-dispute">{error}</p>}

        {agreement && (
          <div className="mx-auto max-w-3xl flex flex-col gap-8">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-foreground">{agreement.agreement_id}</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {weiToGen(agreement.agreed_amount)} GEN · deadline {new Date(agreement.deadline).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={agreement.status} />
                <button
                  onClick={refetch}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  title="Re-read the latest on-chain state"
                >
                  ↻ Refresh
                </button>
              </div>
            </div>

            <section className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <h2 className="text-sm font-medium text-foreground mb-3">Lifecycle</h2>
                <LifecycleTracker status={agreement.status} />
              </div>

              <div className="flex flex-col gap-4">
                <div className="rounded-lg border border-border bg-surface p-4 text-sm">
                  <p className="text-muted-foreground mb-2">Parties</p>
                  <p className="text-foreground break-all">Buyer: {agreement.buyer}</p>
                  <p className="text-foreground break-all">Provider: {agreement.provider}</p>
                </div>
                <div className="rounded-lg border border-border bg-surface p-4 text-sm">
                  <p className="text-muted-foreground mb-2">Escrow</p>
                  <p className="text-foreground">
                    {weiToGen(agreement.escrow_deposited)} / {weiToGen(agreement.agreed_amount)} GEN deposited
                  </p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-sm font-medium text-foreground mb-2">Terms</h2>
              <pre className="whitespace-pre-wrap rounded-lg border border-border bg-surface p-4 text-sm text-foreground font-sans">
                {agreement.terms}
              </pre>
            </section>

            {agreement.status === "DISPUTED" || agreement.status === "UNDER_REVIEW" || agreement.status === "JUDGED" ? (
              <a
                href={`/disputes/${agreement.agreement_id}`}
                className="text-sm text-dispute underline"
              >
                View dispute →
              </a>
            ) : null}

            <TxStatusBanner stage={tx.stage} hash={tx.hash} error={tx.error} />

            <section className="flex flex-wrap gap-3">
              {isProvider && agreement.status === "DRAFT" && (
                <ActionButton
                  label="Accept Agreement"
                  busy={busy && activeAction === "accept"}
                  disabled={busy}
                  onClick={() =>
                    run("accept", () => writeCourtFlow(client!, "accept_agreement", [id]))
                  }
                />
              )}
              {isBuyer && agreement.status === "DRAFT" && (
                <ActionButton
                  label="Cancel"
                  variant="ghost"
                  busy={busy && activeAction === "cancel"}
                  disabled={busy}
                  onClick={() =>
                    run("cancel", () => writeCourtFlow(client!, "cancel_agreement", [id]))
                  }
                />
              )}
              {isBuyer && agreement.status === "ACTIVE" && (
                <ActionButton
                  label={`Fund Escrow (${weiToGen(agreement.agreed_amount)} GEN)`}
                  busy={busy && activeAction === "fund"}
                  disabled={busy}
                  onClick={() =>
                    run("fund", () =>
                      writeCourtFlow(
                        client!,
                        "fund_agreement",
                        [id],
                        parseGenAmount(agreement.agreed_amount)
                      )
                    )
                  }
                />
              )}
              {isBuyer && agreement.status === "DELIVERED" && (
                <>
                  <ActionButton
                    label="Approve Delivery"
                    busy={busy && activeAction === "approve"}
                    disabled={busy}
                    onClick={() =>
                      run("approve", () => writeCourtFlow(client!, "approve_delivery", [id]))
                    }
                  />
                  <ActionButton
                    label="Open Dispute"
                    variant="dispute"
                    disabled={busy}
                    onClick={() => router.push(`/disputes/${id}?open=1`)}
                  />
                </>
              )}
              {isBuyer && agreement.status === "FUNDED" && (
                <ActionButton
                  label="Claim Timeout Refund"
                  variant="ghost"
                  busy={busy && activeAction === "timeout"}
                  disabled={busy}
                  onClick={() =>
                    run("timeout", () => writeCourtFlow(client!, "claim_timeout", [id]))
                  }
                />
              )}
              {isProvider && agreement.status === "DELIVERED" && (
                <ActionButton
                  label="Claim Delivery Timeout"
                  variant="ghost"
                  busy={busy && activeAction === "delivery-timeout"}
                  disabled={busy}
                  onClick={() =>
                    run("delivery-timeout", () =>
                      writeCourtFlow(client!, "claim_delivery_timeout", [id])
                    )
                  }
                />
              )}
            </section>

            {isProvider && agreement.status === "FUNDED" && (
              <section className="rounded-lg border border-primary/40 bg-primary/5 p-5">
                <h2 className="text-sm font-medium text-foreground mb-3">Submit Delivery</h2>
                <label className="flex flex-col gap-1.5 mb-3">
                  <span className="text-xs text-muted-foreground">File references (one per line)</span>
                  <textarea
                    value={fileRefs}
                    onChange={(e) => setFileRefs(e.target.value)}
                    rows={3}
                    className="input w-full font-mono text-xs"
                  />
                </label>
                <label className="flex flex-col gap-1.5 mb-3">
                  <span className="text-xs text-muted-foreground">Metadata / notes</span>
                  <input
                    value={deliveryMetadata}
                    onChange={(e) => setDeliveryMetadata(e.target.value)}
                    className="input w-full"
                  />
                </label>
                <ActionButton
                  label="Submit Delivery"
                  busy={busy && activeAction === "deliver"}
                  disabled={busy}
                  onClick={() => {
                    const refs = fileRefs
                      .split("\n")
                      .map((r) => r.trim())
                      .filter(Boolean);
                    return run("deliver", () =>
                      writeCourtFlow(client!, "submit_delivery", [
                        id,
                        `del-${id}`,
                        refs,
                        deliveryMetadata,
                      ])
                    );
                  }}
                />
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  busy,
  disabled,
  variant = "primary",
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "dispute";
}) {
  const styles = {
    primary: "bg-primary text-white hover:bg-primary/90",
    ghost: "border border-border text-foreground hover:border-primary/60",
    dispute: "border border-dispute/60 text-dispute hover:bg-dispute/10",
  }[variant];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${styles}`}
    >
      {busy ? "Working…" : label}
    </button>
  );
}
