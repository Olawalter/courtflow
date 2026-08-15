import { beforeEach, describe, expect, it } from "vitest";
import {
  EXPECTED_CHAIN_ID,
  WrongNetworkError,
  activeChain,
  ensureActiveChain,
  readWalletChainId,
} from "@/lib/genlayer/network";
import { COURTFLOW_ADDRESS, writeCourtFlow } from "@/lib/genlayer/contract";
import { MockWallet, clearWallet, installWallet } from "./mockWallet";

const DEPLOYED = "0xAC2F534da76dFe59e3dBbCB3F822E414E3fd81dE";
const ETH_MAINNET = 1;

/**
 * Stands in for the genlayer-js client, reproducing what it actually does on
 * the injected-wallet path (dist/index.js, `eth_sendTransaction` branch):
 * it builds a legacy tx request carrying an explicit
 * `chainId: 0x<client.chain.id>` and hands it to the wallet provider.
 *
 * That explicit chainId is the field MetaMask compares against its selected
 * network — the whole reason the reviewer's transaction was rejected.
 */
function makeClient(wallet: MockWallet) {
  const writes: { address: string; functionName: string; value: bigint }[] = [];
  const client = {
    chain: activeChain,
    writes,
    async writeContract({
      address,
      functionName,
      value,
    }: {
      address: string;
      functionName: string;
      args?: unknown;
      value?: bigint;
    }) {
      writes.push({ address, functionName, value: value ?? BigInt(0) });
      return wallet.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: wallet.accounts[0],
            to: "0xconsensus",
            data: "0x00",
            value: `0x${(value ?? BigInt(0)).toString(16)}`,
            gas: "0x30d40",
            nonce: "0x0",
            type: "0x0",
            chainId: `0x${activeChain.id.toString(16)}`,
          },
        ],
      });
    },
  };
  return client as unknown as Parameters<typeof writeCourtFlow>[0] & {
    writes: typeof writes;
  };
}

const CREATE_ARGS = [
  "logo-design-001",
  "0x2222222222222222222222222222222222222222",
  "Create an original company logo.",
  BigInt(500) * BigInt(10) ** BigInt(18),
  "2026-09-01T12:00:00.000Z",
  86400,
];

beforeEach(() => {
  clearWallet();
});

// ─── Configuration is the one the live deployment uses ───────────────────────

describe("network configuration", () => {
  it("targets GenLayer StudioNet chain 61999", () => {
    expect(EXPECTED_CHAIN_ID).toBe(61999);
    expect(activeChain.id).toBe(61999);
    expect(activeChain.rpcUrls.default.http[0]).toBe(
      "https://studio.genlayer.com/api"
    );
  });

  // Test 4 — the transaction targets the real deployed contract.
  it("points at the deployed CourtFlow contract", () => {
    expect(COURTFLOW_ADDRESS).toBe(DEPLOYED);
  });
});

// ─── The failure being fixed, reproduced exactly ─────────────────────────────

describe("the reviewer's failure, reproduced", () => {
  it("an unguarded send on the wrong chain fails with the reported error", async () => {
    const wallet = new MockWallet({ chainId: ETH_MAINNET });
    installWallet(wallet);
    const client = makeClient(wallet);

    // Calling the client directly = the old code path, with no chain guard.
    await expect(
      client.writeContract({
        address: DEPLOYED,
        functionName: "create_agreement",
        value: BigInt(0),
      })
    ).rejects.toThrow(/chainId should be same as current chainId/);
  });

  it("the same call succeeds once the guard has reconciled the chain", async () => {
    const wallet = new MockWallet({
      chainId: ETH_MAINNET,
      knownChains: [ETH_MAINNET, EXPECTED_CHAIN_ID],
    });
    installWallet(wallet);
    const client = makeClient(wallet);

    await expect(
      writeCourtFlow(client, "create_agreement", CREATE_ARGS)
    ).resolves.toBeTruthy();
    expect(wallet.sentTransactions).toHaveLength(1);
  });
});

// ─── Test 1 — already on StudioNet ───────────────────────────────────────────

describe("Test 1: wallet already on chain 61999", () => {
  it("submits create_agreement without prompting a switch", async () => {
    const wallet = new MockWallet({ chainId: EXPECTED_CHAIN_ID });
    installWallet(wallet);
    const client = makeClient(wallet);

    const hash = await writeCourtFlow(client, "create_agreement", CREATE_ARGS);

    expect(hash).toBeTruthy();
    expect(wallet.sentTransactions).toHaveLength(1);
    // No unnecessary network prompts for a user already on the right chain.
    expect(wallet.callsOf("wallet_switchEthereumChain")).toHaveLength(0);
    expect(wallet.callsOf("wallet_addEthereumChain")).toHaveLength(0);
  });

  // Test 4 — the submitted call carries the deployed contract address.
  it("addresses the deployed CourtFlow contract", async () => {
    const wallet = new MockWallet({ chainId: EXPECTED_CHAIN_ID });
    installWallet(wallet);
    const client = makeClient(wallet);

    await writeCourtFlow(client, "create_agreement", CREATE_ARGS);

    expect(client.writes).toHaveLength(1);
    expect(client.writes[0].address).toBe(DEPLOYED);
    expect(client.writes[0].functionName).toBe("create_agreement");
  });
});

// ─── Test 2 — wrong chain, switch refused ────────────────────────────────────

describe("Test 2: wallet on the wrong chain", () => {
  it("does NOT submit, and asks the wallet to switch", async () => {
    const wallet = new MockWallet({
      chainId: ETH_MAINNET,
      knownChains: [ETH_MAINNET, EXPECTED_CHAIN_ID],
      rejectSwitch: true, // user clicks "Reject" on the prompt
    });
    installWallet(wallet);
    const client = makeClient(wallet);

    await expect(
      writeCourtFlow(client, "create_agreement", CREATE_ARGS)
    ).rejects.toBeInstanceOf(WrongNetworkError);

    // The switch WAS requested...
    expect(wallet.callsOf("wallet_switchEthereumChain").length).toBeGreaterThan(0);
    // ...and critically, nothing was ever sent.
    expect(wallet.sentTransactions).toHaveLength(0);
    expect(client.writes).toHaveLength(0);
  });

  it("explains what the user has to do", async () => {
    const wallet = new MockWallet({
      chainId: ETH_MAINNET,
      knownChains: [ETH_MAINNET, EXPECTED_CHAIN_ID],
      rejectSwitch: true,
    });
    installWallet(wallet);
    const client = makeClient(wallet);

    await expect(
      writeCourtFlow(client, "create_agreement", CREATE_ARGS)
    ).rejects.toThrow(/61999/);
  });

  it("adds the chain first when the wallet has never seen StudioNet", async () => {
    const wallet = new MockWallet({
      chainId: ETH_MAINNET,
      knownChains: [ETH_MAINNET], // StudioNet unknown -> 4902
    });
    installWallet(wallet);
    const client = makeClient(wallet);

    await expect(
      writeCourtFlow(client, "create_agreement", CREATE_ARGS)
    ).resolves.toBeTruthy();

    const added = wallet.callsOf("wallet_addEthereumChain");
    expect(added).toHaveLength(1);
    const params = added[0].params?.[0] as {
      chainId: string;
      rpcUrls: string[];
      nativeCurrency: { symbol: string };
    };
    expect(params.chainId).toBe("0xf22f"); // 61999
    expect(params.rpcUrls).toContain("https://studio.genlayer.com/api");
    expect(params.nativeCurrency.symbol).toBe("GEN");
    expect(wallet.sentTransactions).toHaveLength(1);
  });

  it("does not submit when the user refuses to add the chain", async () => {
    const wallet = new MockWallet({
      chainId: ETH_MAINNET,
      knownChains: [ETH_MAINNET],
      rejectAdd: true,
    });
    installWallet(wallet);
    const client = makeClient(wallet);

    await expect(
      writeCourtFlow(client, "create_agreement", CREATE_ARGS)
    ).rejects.toBeInstanceOf(WrongNetworkError);
    expect(wallet.sentTransactions).toHaveLength(0);
  });
});

// ─── Test 3 — switch, then revalidate, then proceed ──────────────────────────

describe("Test 3: wallet switches to 61999", () => {
  it("revalidates the chain and then submits", async () => {
    const wallet = new MockWallet({
      chainId: ETH_MAINNET,
      knownChains: [ETH_MAINNET, EXPECTED_CHAIN_ID],
    });
    installWallet(wallet);
    const client = makeClient(wallet);

    expect(await readWalletChainId(wallet)).toBe(ETH_MAINNET);

    const hash = await writeCourtFlow(client, "create_agreement", CREATE_ARGS);

    expect(hash).toBeTruthy();
    expect(wallet.chainId).toBe(EXPECTED_CHAIN_ID);
    expect(wallet.sentTransactions).toHaveLength(1);

    // The chain was re-read AFTER the switch, not assumed from its resolution.
    const order = wallet.calls.map((c) => c.method);
    const switchAt = order.indexOf("wallet_switchEthereumChain");
    const sendAt = order.indexOf("eth_sendTransaction");
    const recheckAt = order.indexOf("eth_chainId", switchAt);
    expect(switchAt).toBeGreaterThanOrEqual(0);
    expect(recheckAt).toBeGreaterThan(switchAt);
    expect(sendAt).toBeGreaterThan(recheckAt);
  });

  it("ensureActiveChain returns the confirmed chain id", async () => {
    const wallet = new MockWallet({
      chainId: ETH_MAINNET,
      knownChains: [ETH_MAINNET, EXPECTED_CHAIN_ID],
    });
    installWallet(wallet);
    await expect(ensureActiveChain(wallet)).resolves.toBe(EXPECTED_CHAIN_ID);
  });
});

// ─── Test 5 — no send while the chain still mismatches ───────────────────────

describe("Test 5: chain mismatch is never sent through", () => {
  it("blocks the send when the wallet lies about switching", async () => {
    // Wallet resolves wallet_switchEthereumChain but stays put — the exact
    // case that makes trusting the switch call's resolution unsafe.
    const wallet = new MockWallet({
      chainId: ETH_MAINNET,
      knownChains: [ETH_MAINNET, EXPECTED_CHAIN_ID],
      switchSilentlyFails: true,
    });
    installWallet(wallet);
    const client = makeClient(wallet);

    await expect(
      writeCourtFlow(client, "create_agreement", CREATE_ARGS)
    ).rejects.toBeInstanceOf(WrongNetworkError);
    expect(wallet.sentTransactions).toHaveLength(0);
    expect(client.writes).toHaveLength(0);
  });

  it("blocks every state-changing method, not just create_agreement", async () => {
    const methods = [
      "accept_agreement",
      "fund_agreement",
      "submit_delivery",
      "approve_delivery",
      "open_dispute",
      "respond_to_dispute",
      "run_judgment",
      "cancel_agreement",
      "claim_timeout",
      "claim_delivery_timeout",
    ];
    for (const method of methods) {
      const wallet = new MockWallet({
        chainId: ETH_MAINNET,
        knownChains: [ETH_MAINNET, EXPECTED_CHAIN_ID],
        rejectSwitch: true,
      });
      installWallet(wallet);
      const client = makeClient(wallet);
      await expect(
        writeCourtFlow(client, method, ["x"])
      ).rejects.toBeInstanceOf(WrongNetworkError);
      expect(wallet.sentTransactions).toHaveLength(0);
    }
  });

  it("refuses to send when no wallet is present at all", async () => {
    clearWallet();
    const wallet = new MockWallet({ chainId: EXPECTED_CHAIN_ID });
    const client = makeClient(wallet);
    await expect(
      writeCourtFlow(client, "create_agreement", CREATE_ARGS)
    ).rejects.toBeInstanceOf(WrongNetworkError);
    expect(wallet.sentTransactions).toHaveLength(0);
  });
});
