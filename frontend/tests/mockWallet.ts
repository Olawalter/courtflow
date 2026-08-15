/**
 * A faithful stand-in for an injected EIP-1193 wallet (MetaMask/Rabby).
 *
 * The important behaviour it reproduces is the one that broke CourtFlow: when
 * `eth_sendTransaction` params carry a `chainId` that differs from the wallet's
 * currently selected network, MetaMask rejects the request with
 *
 *   -32602  Invalid parameters ... chainId should be same as current chainId
 *
 * viem surfaces exactly that as `InvalidParamsRpcError`. Reproducing it here
 * means these tests fail the same way the reviewer's browser did if the guard
 * ever regresses, instead of passing against a forgiving fake.
 */

export interface RpcCall {
  method: string;
  params?: unknown[];
}

export class WalletRpcError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "WalletRpcError";
    this.code = code;
  }
}

export interface MockWalletOptions {
  /** Chain the wallet starts on (decimal). */
  chainId: number;
  /** Chains the wallet already knows about; unknown ones trigger 4902. */
  knownChains?: number[];
  /** Simulate the user clicking "Reject" on the network-switch prompt. */
  rejectSwitch?: boolean;
  /** Simulate the user rejecting the add-chain prompt. */
  rejectAdd?: boolean;
  /** Simulate a wallet that reports success but never actually switches. */
  switchSilentlyFails?: boolean;
  accounts?: string[];
}

export class MockWallet {
  chainId: number;
  knownChains: Set<number>;
  opts: MockWalletOptions;
  /** Every RPC call made, in order — lets tests assert what was/wasn't sent. */
  calls: RpcCall[] = [];
  /** Transactions the wallet actually accepted and "signed". */
  sentTransactions: Record<string, unknown>[] = [];

  constructor(opts: MockWalletOptions) {
    this.opts = opts;
    this.chainId = opts.chainId;
    this.knownChains = new Set(opts.knownChains ?? [opts.chainId]);
  }

  get accounts(): string[] {
    return this.opts.accounts ?? ["0x1111111111111111111111111111111111111111"];
  }

  /** Calls of a given method. */
  callsOf(method: string): RpcCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  request = async (args: RpcCall): Promise<unknown> => {
    this.calls.push({ method: args.method, params: args.params });
    const { method, params } = args;

    switch (method) {
      case "eth_chainId":
        return `0x${this.chainId.toString(16)}`;

      case "eth_accounts":
      case "eth_requestAccounts":
        return this.accounts;

      case "wallet_switchEthereumChain": {
        const target = parseInt(
          (params?.[0] as { chainId: string }).chainId,
          16
        );
        if (!this.knownChains.has(target)) {
          throw new WalletRpcError(
            4902,
            "Unrecognized chain ID. Try adding the chain using wallet_addEthereumChain first."
          );
        }
        if (this.opts.rejectSwitch) {
          throw new WalletRpcError(4001, "User rejected the request.");
        }
        if (!this.opts.switchSilentlyFails) this.chainId = target;
        return null;
      }

      case "wallet_addEthereumChain": {
        if (this.opts.rejectAdd) {
          throw new WalletRpcError(4001, "User rejected the request.");
        }
        const added = parseInt((params?.[0] as { chainId: string }).chainId, 16);
        this.knownChains.add(added);
        return null;
      }

      case "eth_sendTransaction": {
        const tx = (params?.[0] ?? {}) as Record<string, unknown>;
        // ── The exact MetaMask validation that produced the reviewer's error ──
        if (tx.chainId !== undefined) {
          const txChainId = parseInt(String(tx.chainId), 16);
          if (txChainId !== this.chainId) {
            throw new WalletRpcError(
              -32602,
              "Invalid parameters: must provide an Ethereum address. chainId should be same as current chainId"
            );
          }
        }
        this.sentTransactions.push(tx);
        return "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
      }

      case "eth_gasPrice":
        return "0x0";
      case "eth_getTransactionCount":
        return "0x0";
      case "eth_estimateGas":
        return "0x30d40";
      default:
        return null;
    }
  };

  on() {}
  removeListener() {}
}

/** Install a mock wallet as window.ethereum, mirroring a browser session. */
export function installWallet(wallet: MockWallet) {
  (globalThis as unknown as { window: { ethereum: unknown } }).window.ethereum =
    wallet as unknown;
  return wallet;
}

export function clearWallet() {
  delete (globalThis as unknown as { window: { ethereum?: unknown } }).window
    .ethereum;
}
