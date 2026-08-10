"use client";

import { create } from "zustand";
import { createClient, chains } from "genlayer-js";
import type { GenLayerClient } from "genlayer-js/types";
import type { Address } from "genlayer-js/types";

export type ChainName = "localnet" | "studionet" | "testnetAsimov" | "testnetBradbury";

const CHAIN_MAP = {
  localnet: chains.localnet,
  studionet: chains.studionet,
  testnetAsimov: chains.testnetAsimov,
  testnetBradbury: chains.testnetBradbury,
} as const;

// The network CourtFlow targets. StudioNet is gasless and is the default for
// the demo; switch via NEXT_PUBLIC_GENLAYER_CHAIN for testnets.
export const ACTIVE_CHAIN_NAME: ChainName =
  (process.env.NEXT_PUBLIC_GENLAYER_CHAIN as ChainName) || "studionet";

export const activeChain = CHAIN_MAP[ACTIVE_CHAIN_NAME];

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

interface WalletState {
  address: Address | null;
  client: GenLayerClient<typeof activeChain> | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

// CourtFlow never generates or stores a private key: signing is always
// delegated to the user's injected wallet (MetaMask/Rabby/etc.) via
// window.ethereum, per genlayer-js's ClientConfig.provider / account pattern.
export const useWallet = create<WalletState>((set) => ({
  address: null,
  client: null,
  connecting: false,
  error: null,

  connect: async () => {
    if (typeof window === "undefined" || !window.ethereum) {
      set({ error: "No injected wallet found. Install MetaMask, Rabby, or a compatible wallet." });
      return;
    }

    set({ connecting: true, error: null });
    try {
      const provider = window.ethereum;
      const accounts = (await provider.request({
        method: "eth_requestAccounts",
      })) as string[];

      const address = accounts[0] as Address;
      if (!address) throw new Error("No account returned by wallet");

      const client = createClient({
        chain: activeChain,
        account: address,
        provider,
      }) as GenLayerClient<typeof activeChain>;

      set({ address, client, connecting: false, error: null });
    } catch (err) {
      set({
        connecting: false,
        error: err instanceof Error ? err.message : "Failed to connect wallet",
      });
    }
  },

  disconnect: () => {
    set({ address: null, client: null, error: null });
  },
}));

function syncAccounts(accounts: string[]) {
  const state = useWallet.getState();
  if (!state.address) return; // not connected yet, nothing to sync

  if (accounts.length === 0) {
    useWallet.setState({ address: null, client: null });
    return;
  }

  const newAddress = accounts[0] as Address;
  if (newAddress.toLowerCase() === state.address.toLowerCase()) return;

  const client = createClient({
    chain: activeChain,
    account: newAddress,
    provider: window.ethereum,
  }) as GenLayerClient<typeof activeChain>;

  useWallet.setState({ address: newAddress, client });
}

if (typeof window !== "undefined" && window.ethereum) {
  // Primary path: MetaMask/Rabby fire `accountsChanged` when the user
  // switches accounts in the extension's own UI.
  window.ethereum.on?.("accountsChanged", (...args: unknown[]) => {
    syncAccounts(args[0] as string[]);
  });

  // Fallback: not every wallet extension reliably emits accountsChanged to
  // every connected site (verified: switching accounts in-extension did not
  // update this app's connected address). `eth_accounts` is a permission-
  // free read, safe to call opportunistically -- re-check whenever the tab
  // regains focus, which naturally happens right after using the extension
  // popup to switch accounts.
  window.addEventListener("focus", () => {
    if (!useWallet.getState().address) return;
    window.ethereum
      ?.request({ method: "eth_accounts" })
      .then((accounts) => syncAccounts(accounts as string[]))
      .catch(() => {});
  });
}

export function useGenLayerClient() {
  return useWallet((s) => s.client);
}
