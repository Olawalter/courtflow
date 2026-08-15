"use client";

import { create } from "zustand";
import { createClient } from "genlayer-js";
import type { GenLayerClient } from "genlayer-js/types";
import type { Address } from "genlayer-js/types";
import {
  ACTIVE_CHAIN_NAME,
  EXPECTED_CHAIN_ID,
  EXPECTED_CHAIN_LABEL,
  WrongNetworkError,
  activeChain,
  ensureActiveChain,
  parseChainId,
  readWalletChainId,
  type ChainName,
  type Eip1193Provider,
} from "./network";

// The chain configuration lives in ./network so the wallet, the read client and
// the write path can never disagree about which network CourtFlow is on.
// Re-exported here for the existing import sites.
export { ACTIVE_CHAIN_NAME, activeChain, EXPECTED_CHAIN_ID, EXPECTED_CHAIN_LABEL };
export type { ChainName };

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

interface WalletState {
  address: Address | null;
  client: GenLayerClient<typeof activeChain> | null;
  /** Chain the wallet is currently on; null when unknown/disconnected. */
  chainId: number | null;
  connecting: boolean;
  /** True when connected but pointed at the wrong network. */
  wrongNetwork: boolean;
  error: string | null;
  connect: () => Promise<void>;
  /** Ask the wallet to move to the expected chain. Returns true on success. */
  switchNetwork: () => Promise<boolean>;
  disconnect: () => void;
}

// CourtFlow never generates or stores a private key: signing is always
// delegated to the user's injected wallet (MetaMask/Rabby/etc.) via
// window.ethereum, per genlayer-js's ClientConfig.provider / account pattern.
export const useWallet = create<WalletState>((set) => ({
  address: null,
  client: null,
  chainId: null,
  connecting: false,
  wrongNetwork: false,
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

      // Put the wallet on the right network at connect time so the user isn't
      // ambushed by a network prompt at the moment they submit an agreement.
      // A refusal here is not fatal: we stay connected, flag wrongNetwork, and
      // the write path will ask again before it sends anything.
      let chainId = await readWalletChainId(provider);
      let chainError: string | null = null;
      try {
        chainId = await ensureActiveChain(provider);
      } catch (err) {
        chainError =
          err instanceof WrongNetworkError
            ? err.message
            : `Switch your wallet to ${EXPECTED_CHAIN_LABEL} (chain ${EXPECTED_CHAIN_ID}) to transact.`;
        chainId = await readWalletChainId(provider);
      }

      const client = createClient({
        chain: activeChain,
        account: address,
        provider,
      }) as GenLayerClient<typeof activeChain>;

      set({
        address,
        client,
        chainId,
        wrongNetwork: chainId !== EXPECTED_CHAIN_ID,
        connecting: false,
        error: chainError,
      });
    } catch (err) {
      set({
        connecting: false,
        error: err instanceof Error ? err.message : "Failed to connect wallet",
      });
    }
  },

  switchNetwork: async () => {
    const provider = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!provider) {
      set({ error: "No injected wallet found." });
      return false;
    }
    try {
      const chainId = await ensureActiveChain(provider);
      set({ chainId, wrongNetwork: false, error: null });
      return true;
    } catch (err) {
      const chainId = await readWalletChainId(provider);
      set({
        chainId,
        wrongNetwork: chainId !== EXPECTED_CHAIN_ID,
        error:
          err instanceof WrongNetworkError
            ? err.message
            : `Switch your wallet to ${EXPECTED_CHAIN_LABEL} (chain ${EXPECTED_CHAIN_ID}) to continue.`,
      });
      return false;
    }
  },

  disconnect: () => {
    set({ address: null, client: null, chainId: null, wrongNetwork: false, error: null });
  },
}));

function syncAccounts(accounts: string[]) {
  const state = useWallet.getState();
  if (!state.address) return; // not connected yet, nothing to sync

  if (accounts.length === 0) {
    useWallet.setState({ address: null, client: null, chainId: null, wrongNetwork: false });
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

function syncChain(rawChainId: unknown) {
  const chainId = parseChainId(rawChainId);
  const onExpected = chainId === EXPECTED_CHAIN_ID;
  useWallet.setState((s) => ({
    chainId,
    wrongNetwork: s.address ? !onExpected : false,
    // Clear a stale wrong-network message once the user lands on the right chain.
    error: onExpected && s.wrongNetwork ? null : s.error,
  }));
}

if (typeof window !== "undefined" && window.ethereum) {
  // Primary path: MetaMask/Rabby fire `accountsChanged` when the user
  // switches accounts in the extension's own UI.
  window.ethereum.on?.("accountsChanged", (...args: unknown[]) => {
    syncAccounts(args[0] as string[]);
  });

  // Keep the wrong-network flag honest when the user changes network in the
  // extension instead of through our button.
  window.ethereum.on?.("chainChanged", (...args: unknown[]) => {
    syncChain(args[0]);
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
    readWalletChainId(window.ethereum ?? null).then((id) => {
      if (id !== null) syncChain(id);
    });
  });
}

export function useGenLayerClient() {
  return useWallet((s) => s.client);
}
