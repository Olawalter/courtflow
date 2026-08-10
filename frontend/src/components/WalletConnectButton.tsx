"use client";

import { Wallet } from "lucide-react";
import { useWallet } from "@/lib/genlayer/wallet";

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function WalletConnectButton() {
  const { address, connecting, error, connect, disconnect } = useWallet();

  if (address) {
    return (
      <button
        onClick={disconnect}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground hover:border-primary/60 transition-colors"
      >
        <span className="h-2 w-2 rounded-full bg-success" />
        {short(address)}
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
