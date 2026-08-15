"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useWallet } from "@/lib/genlayer/wallet";
import { EXPECTED_CHAIN_ID, EXPECTED_CHAIN_LABEL } from "@/lib/genlayer/network";

/**
 * Shown whenever a connected wallet is pointed at the wrong network.
 *
 * CourtFlow's write path refuses to send a transaction off the expected chain
 * (the wallet would reject it anyway with "chainId should be same as current
 * chainId"), so this makes the required action explicit instead of letting the
 * user discover it as an RPC error at submit time.
 */
export function NetworkBanner() {
  const address = useWallet((s) => s.address);
  const wrongNetwork = useWallet((s) => s.wrongNetwork);
  const chainId = useWallet((s) => s.chainId);
  const switchNetwork = useWallet((s) => s.switchNetwork);
  const [switching, setSwitching] = useState(false);

  if (!address || !wrongNetwork) return null;

  const onSwitch = async () => {
    setSwitching(true);
    try {
      await switchNetwork();
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-md border border-dispute/40 bg-dispute/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-dispute" />
        <div className="text-sm">
          <p className="font-medium text-foreground">Wrong network</p>
          <p className="text-muted-foreground">
            Please switch your wallet to {EXPECTED_CHAIN_LABEL} (chain{" "}
            {EXPECTED_CHAIN_ID})
            {chainId !== null ? ` — you are on chain ${chainId}` : ""}. CourtFlow
            can&apos;t submit transactions from another network.
          </p>
        </div>
      </div>
      <button
        onClick={onSwitch}
        disabled={switching}
        className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
      >
        {switching ? "Switching…" : `Switch to ${EXPECTED_CHAIN_LABEL}`}
      </button>
    </div>
  );
}
