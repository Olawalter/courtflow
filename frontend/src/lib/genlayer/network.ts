"use client";

import { chains } from "genlayer-js";

// ─── Single authoritative network configuration ──────────────────────────────
//
// Every part of the app (wallet store, read client, write path, UI copy) reads
// the chain from HERE. Nothing else may define a chain id, an RPC URL or a
// network name, so the wallet, the viem/genlayer-js client and the transaction
// request can never drift apart.

export type ChainName =
  | "localnet"
  | "studionet"
  | "testnetAsimov"
  | "testnetBradbury";

const CHAIN_MAP = {
  localnet: chains.localnet,
  studionet: chains.studionet,
  testnetAsimov: chains.testnetAsimov,
  testnetBradbury: chains.testnetBradbury,
} as const;

// The network CourtFlow targets. StudioNet (chain 61999) is gasless and is the
// default for the demo; switch via NEXT_PUBLIC_GENLAYER_CHAIN for testnets.
export const ACTIVE_CHAIN_NAME: ChainName =
  (process.env.NEXT_PUBLIC_GENLAYER_CHAIN as ChainName) || "studionet";

export const activeChain = CHAIN_MAP[ACTIVE_CHAIN_NAME] ?? CHAIN_MAP.studionet;

/** Chain id the wallet MUST be on before any state-changing call. 61999 for StudioNet. */
export const EXPECTED_CHAIN_ID: number = activeChain.id;
export const EXPECTED_CHAIN_ID_HEX = `0x${EXPECTED_CHAIN_ID.toString(16)}`;
export const EXPECTED_CHAIN_LABEL = activeChain.name;

/** EIP-3085 parameters for `wallet_addEthereumChain`, derived from the chain
 * definition above so there is exactly one source of truth. */
export function activeChainParams() {
  return {
    chainId: EXPECTED_CHAIN_ID_HEX,
    chainName: activeChain.name,
    rpcUrls: [...activeChain.rpcUrls.default.http],
    nativeCurrency: activeChain.nativeCurrency,
    ...(activeChain.blockExplorers?.default.url
      ? { blockExplorerUrls: [activeChain.blockExplorers.default.url] }
      : {}),
  };
}

// ─── Provider plumbing ───────────────────────────────────────────────────────

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

/** Raised when the wallet is not on (and could not be moved to) the expected
 * chain. Callers must treat this as "do NOT send the transaction". */
export class WrongNetworkError extends Error {
  readonly currentChainId: number | null;
  constructor(message: string, currentChainId: number | null) {
    super(message);
    this.name = "WrongNetworkError";
    this.currentChainId = currentChainId;
  }
}

export function getInjectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
}

function errorCode(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const direct = (err as { code?: unknown }).code;
  if (typeof direct === "number") return direct;
  // MetaMask sometimes nests the RPC error one level down.
  const nested = (err as { data?: { originalError?: { code?: unknown } } }).data
    ?.originalError?.code;
  return typeof nested === "number" ? nested : null;
}

export function parseChainId(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.length > 0) {
    const parsed = raw.startsWith("0x") ? parseInt(raw, 16) : parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** Current chain id of the connected wallet, or null if unreadable. */
export async function readWalletChainId(
  provider: Eip1193Provider | null = getInjectedProvider()
): Promise<number | null> {
  if (!provider) return null;
  try {
    return parseChainId(await provider.request({ method: "eth_chainId" }));
  } catch {
    return null;
  }
}

// ─── The guard ───────────────────────────────────────────────────────────────

/**
 * Guarantees the wallet is on the expected chain before a state-changing call.
 *
 * genlayer-js builds `eth_sendTransaction` with an explicit
 * `chainId: 0x<activeChain.id>` field. MetaMask validates that field against
 * its *currently selected* network and rejects the request with
 * `-32602 … chainId should be same as current chainId` when they differ. So the
 * wallet's chain must be reconciled BEFORE the transaction is built, not after.
 *
 * Flow: read chain → if already correct, done → request switch (EIP-3326) →
 * add the chain first if the wallet doesn't know it (EIP-3085, code 4902) →
 * re-read the chain and only return once it is confirmed.
 *
 * Throws WrongNetworkError if the wallet ends up anywhere else — the caller
 * must then NOT submit the transaction.
 */
export async function ensureActiveChain(
  provider: Eip1193Provider | null = getInjectedProvider()
): Promise<number> {
  if (!provider) {
    throw new WrongNetworkError(
      "No injected wallet found. Install MetaMask, Rabby, or a compatible wallet.",
      null
    );
  }

  const current = await readWalletChainId(provider);
  if (current === EXPECTED_CHAIN_ID) return current;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: EXPECTED_CHAIN_ID_HEX }],
    });
  } catch (err) {
    const code = errorCode(err);

    // 4902 (and MetaMask's -32603 variant) => the wallet has never heard of
    // this chain. Add it, then switch again.
    if (code === 4902 || code === -32603) {
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [activeChainParams()],
        });
        // Some wallets switch implicitly on add; others need the explicit call.
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: EXPECTED_CHAIN_ID_HEX }],
        });
      } catch (addErr) {
        throw new WrongNetworkError(
          errorCode(addErr) === 4001
            ? `You declined adding ${EXPECTED_CHAIN_LABEL}. CourtFlow can only transact on ${EXPECTED_CHAIN_LABEL} (chain ${EXPECTED_CHAIN_ID}).`
            : `Could not add ${EXPECTED_CHAIN_LABEL} (chain ${EXPECTED_CHAIN_ID}) to your wallet. Add it manually and try again.`,
          current
        );
      }
    } else if (code === 4001) {
      throw new WrongNetworkError(
        `You declined the network switch. Switch your wallet to ${EXPECTED_CHAIN_LABEL} (chain ${EXPECTED_CHAIN_ID}) to continue.`,
        current
      );
    } else {
      throw new WrongNetworkError(
        `Could not switch your wallet to ${EXPECTED_CHAIN_LABEL} (chain ${EXPECTED_CHAIN_ID}). Switch networks manually and try again.`,
        current
      );
    }
  }

  // Never trust the switch call's resolution alone — re-read and confirm.
  const confirmed = await readWalletChainId(provider);
  if (confirmed !== EXPECTED_CHAIN_ID) {
    throw new WrongNetworkError(
      `Wrong network. Please switch your wallet to ${EXPECTED_CHAIN_LABEL} (chain ${EXPECTED_CHAIN_ID}) before continuing.`,
      confirmed
    );
  }
  return confirmed;
}
