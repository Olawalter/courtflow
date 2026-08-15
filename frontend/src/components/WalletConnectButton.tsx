"use client";

import { Wallet } from "lucide-react";
import { useWallet } from "@/lib/genlayer/wallet";
import { EXPECTED_CHAIN_ID, EXPECTED_CHAIN_LABEL } from "@/lib/genlayer/network";

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function WalletConnectButton() {
  const { address, connecting, error, wrongNetwork, connect, disconnect } = useWallet();

  if (address) {
    return (
      <button
        onClick={disconnect}
        title={
          wrongNetwork
            ? `Wrong network — switch to ${EXPECTED_CHAIN_LABEL} (chain ${EXPECTED_CHAIN_ID})`
            : `Connected to ${EXPECTED_CHAIN_LABEL}`
        }
        className={`inline-flex items-center gap-2 rounded-md border bg-surface px-3 py-1.5 text-sm text-foreground transition-colors ${
          wrongNetwork
            ? "border-dispute/60 hover:border-dispute"
            : "border-border hover:border-primary/60"
        }`}
      >
        <span
          className={`h-2 w-2 rounded-full ${wrongNetwork ? "bg-dispute" : "bg-success"}`}
        />
        {wrongNetwork ? "Wrong network" : short(address)}
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={connect}
        disabled={connecting}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60 transition-colors"
      >
        <Wallet size={16} />
        {connecting ? "Connecting…" : "Connect Wallet"}
      </button>
      {error && <span className="text-xs text-dispute">{error}</span>}
    </div>
  );
}
