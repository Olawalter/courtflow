"use client";

import { useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { TopNav } from "@/components/TopNav";
import { StatusBadge } from "@/components/StatusBadge";
import { ConsensusAnimation } from "@/components/consensus/ConsensusAnimation";
import { useAgreement, useDelivery, useDispute, useJudgment } from "@/lib/genlayer/hooks";
import { useWallet } from "@/lib/genlayer/wallet";
import { writeCourtFlow, waitForCourtFlowTx, weiToGen } from "@/lib/genlayer/contract";
import { EvidenceGraph } from "@/components/evidence/EvidenceGraph";

// MVP convention: one dispute per agreement, dispute_id === agreement_id.
// (Matches the contract's one-delivery-per-agreement simplification.)

export default function DisputeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const openOnLoad = searchParams.get("open") === "1";

  const { data: agreement, error: agreementError, refetch: refetchAgreement } = useAgreement(id);
  const { data: dispute, error: disputeError, refetch: refetchDispute } = useDispute(id);
  // get_judgment reverts on-chain until run_judgment has actually completed
  // (correct contract behavior), which viem/genlayer-js log as a console.error
  // internally before rejecting -- Next's dev overlay then treats that as a
  // blocking error. Only call it once dispute.status is actually JUDGED to
  // avoid triggering that error path in the first place.
  const { data: judgment, refetch: refetchJudgment } = useJudgment(
    dispute?.status === "JUDGED" ? id : null
  );
  const deliveryNotYetSubmitted =
    !agreement || ["DRAFT", "ACTIVE", "FUNDED"].includes(agreement.status);
  const { data: delivery, refetch: refetchDelivery } = useDelivery(id, deliveryNotYetSubmitted);

  function refetchAll() {
    refetchAgreement();
    refetchDispute();
    refetchJudgment();
    refetchDelivery();
  }

  const client = useWallet((s) => s.client);
  const address = useWallet((s) => s.address);

  const [claim, setClaim] = useState("");
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [judging, setJudging] = useState(false);

  const isBuyer = address && agreement && address.toLowerCase() === agreement.buyer.toLowerCase();
  const isProvider =
    address && agreement && address.toLowerCase() === agreement.provider.toLowerCase();
  const isParty = isBuyer || isProvider;

  // Each handler refetches in `finally`, not just on success: the write
  // itself can succeed on-chain even when the client-side wait/poll step
  // throws (flaky RPC, timeout), so a caught error here must not be trusted
  // to mean nothing happened.
  async function openDispute() {
    if (!client || !claim.trim()) return;
    setBusy("open");
    setActionError(null);
    try {
      const hash = await writeCourtFlow(client, "open_dispute", [id, id, claim.trim()]);
      await waitForCourtFlowTx(client, hash);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Transaction failed");
    } finally {
      refetchAll();
      router.refresh();
      setBusy(null);
    }
  }

  async function respondToDispute() {
    if (!client || !response.trim()) return;
    setBusy("respond");
    setActionError(null);
    try {
      const hash = await writeCourtFlow(client, "respond_to_dispute", [id, response.trim()]);
      await waitForCourtFlowTx(client, hash);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Transaction failed");
    } finally {
      refetchAll();
      router.refresh();
      setBusy(null);
    }
  }

  async function triggerJudgment() {
    if (!client) return;
    setJudging(true);
    setActionError(null);
    try {
      const hash = await writeCourtFlow(client, "run_judgment", [id]);
      await waitForCourtFlowTx(client, hash);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Transaction failed");
    } finally {
      refetchAll();
      router.refresh();
      setJudging(false);
    }
  }

  const showOpenForm = (!dispute && (openOnLoad || isBuyer)) && agreement?.status === "DELIVERED";

  return (
    <div className="flex-1 flex flex-col">
      <TopNav />
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-3xl flex flex-col gap-8">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold text-foreground">DISPUTE — {id}</h1>
            <div className="flex items-center gap-3">
              {dispute && <StatusBadge status={dispute.status} />}
              <button
                onClick={refetchAll}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                title="Re-read the latest on-chain state"
              >
                ↻ Refresh
              </button>
            </div>
          </div>

          {agreementError && <p className="text-sm text-dispute">{agreementError}</p>}

          {showOpenForm && (
            <section className="rounded-lg border border-dispute/40 bg-dispute/5 p-5">
              <h2 className="text-sm font-medium text-foreground mb-3">Open a dispute</h2>
              <textarea
                value={claim}
                onChange={(e) => setClaim(e.target.value)}
                placeholder="The logo contains copyrighted material."
                rows={3}
                className="input w-full mb-3"
              />
              <button
                onClick={openDispute}
                disabled={busy === "open" || !claim.trim()}
                className="rounded-md bg-dispute px-4 py-2 text-sm font-medium text-white hover:bg-dispute/90 disabled:opacity-60 transition-colors"
              >
                {busy === "open" ? "Submitting…" : "Submit Dispute"}
              </button>
            </section>
          )}

          {dispute && (
            <>
              <section className="rounded-lg border border-border bg-surface p-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  Buyer Claim
                </p>
                <p className="text-sm text-foreground italic">&ldquo;{dispute.claim}&rdquo;</p>
              </section>

              <div className="mx-auto h-6 w-px bg-border" aria-hidden />

              {dispute.provider_response ? (
                <section className="rounded-lg border border-border bg-surface p-5">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                    Provider Response
                  </p>
                  <p className="text-sm text-foreground">{dispute.provider_response}</p>
                </section>
              ) : isProvider && dispute.status === "OPEN" ? (
                <section className="rounded-lg border border-primary/40 bg-primary/5 p-5">
                  <h2 className="text-sm font-medium text-foreground mb-3">Respond to this dispute</h2>
                  <textarea
                    value={response}
                    onChange={(e) => setResponse(e.target.value)}
                    rows={3}
                    className="input w-full mb-3"
                  />
                  <button
                    onClick={respondToDispute}
                    disabled={busy === "respond" || !response.trim()}
                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60 transition-colors"
                  >
                    {busy === "respond" ? "Submitting…" : "Submit Response"}
                  </button>
                </section>
              ) : (
                <p className="text-center text-sm text-muted-foreground">
                  Waiting for provider response…
                </p>
              )}

              {agreement?.escrow_deposited != null && (
                <section className="rounded-lg border border-border bg-surface p-5 text-sm text-muted-foreground">
                  Escrow held: {weiToGen(agreement.escrow_deposited)} GEN
                </section>
              )}

              {agreement && (
                <section>
                  <h2 className="text-sm font-medium text-foreground mb-4">Evidence</h2>
                  <EvidenceGraph agreement={agreement} delivery={delivery} dispute={dispute} />
                </section>
              )}

              <section>
                <h2 className="text-sm font-medium text-foreground mb-3">Consensus</h2>
                <ConsensusAnimation
                  state={judgment ? "done" : judging ? "running" : "idle"}
                  judgment={judgment}
                  agreedAmount={agreement ? weiToGen(agreement.agreed_amount) : undefined}
                />
              </section>

              {!judgment && dispute.status === "UNDER_REVIEW" && isParty && (
                <button
                  onClick={triggerJudgment}
                  disabled={judging}
                  className="self-center rounded-md bg-consensus px-5 py-2.5 text-sm font-medium text-white hover:bg-consensus/90 disabled:opacity-60 transition-colors"
                >
                  {judging ? "Awaiting Consensus…" : "Send to GenLayer for Judgment"}
                </button>
              )}
            </>
          )}

          {!dispute && !showOpenForm && !disputeError && (
            <p className="text-sm text-muted-foreground">No dispute has been opened yet.</p>
          )}

          {actionError && <p className="text-sm text-dispute">{actionError}</p>}
        </div>
      </main>
    </div>
  );
}
