"use client";

import { useCallback, useState } from "react";
import type { TransactionHash } from "genlayer-js/types";
import { waitForCourtFlowTx } from "./contract";
import { useWallet } from "./wallet";

// Real stages of a GenLayer write, not just "loading": the wallet must sign
// (a separate human-in-the-loop step, can be rejected), the signed tx is
// then submitted and gets a hash, then GenVM validator consensus has to
// actually run (this is the slow part -- LLM-backed for judgment calls) and
// finalize, or the whole thing can fail at any of those points for a
// different reason each time.
export type TxStage =
  | "idle"
  | "awaiting-wallet"
  | "submitted"
  | "pending-consensus"
  | "finalized"
  | "failed";

export interface TxState {
  stage: TxStage;
  hash: TransactionHash | null;
  error: string | null;
}

const IDLE: TxState = { stage: "idle", hash: null, error: null };

export function useTxStatus() {
  const [state, setState] = useState<TxState>(IDLE);
  const client = useWallet((s) => s.client);

  const run = useCallback(
    async (
      submit: () => Promise<TransactionHash>,
      onSettled?: () => void
    ): Promise<boolean> => {
      if (!client) {
        setState({ stage: "failed", hash: null, error: "No wallet connected" });
        return false;
      }

      setState({ stage: "awaiting-wallet", hash: null, error: null });
      try {
        // The wallet extension prompts here; this promise doesn't resolve
        // until the user approves (or rejects) the signature.
        const hash = await submit();
        setState({ stage: "submitted", hash, error: null });

        setState({ stage: "pending-consensus", hash, error: null });
        const receipt = await waitForCourtFlowTx(client, hash);

        const statusName = (receipt as { status_name?: string }).status_name;
        if (statusName && !["ACCEPTED", "FINALIZED"].includes(statusName)) {
          setState({
            stage: "failed",
            hash,
            error: `Transaction did not reach a successful status (${statusName})`,
          });
          return false;
        }

        setState({ stage: "finalized", hash, error: null });
        return true;
      } catch (err) {
        // The write itself may have already succeeded on-chain even if this
        // wait/poll step throws (flaky RPC, timeout) -- callers should still
        // refetch on failure, not assume nothing happened.
        setState({
          stage: "failed",
          hash: state.hash,
          error: err instanceof Error ? err.message : "Transaction failed",
        });
        return false;
      } finally {
        onSettled?.();
      }
    },
    [client, state.hash]
  );

  const reset = useCallback(() => setState(IDLE), []);

  return { ...state, run, reset };
}

export const TX_STAGE_LABEL: Record<TxStage, string> = {
  idle: "",
  "awaiting-wallet": "Waiting for wallet confirmation…",
  submitted: "Transaction submitted…",
  "pending-consensus": "Awaiting GenLayer validator consensus…",
  finalized: "Finalized",
  failed: "Failed",
};
