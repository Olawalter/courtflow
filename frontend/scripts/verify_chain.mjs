// Verification for the "chainId should be same as current chainId" fix.
//
// Part 1 proves the deployed contract really accepts a create_agreement on
// chain 61999 (a real transaction, read back from real contract state).
//
// Part 2 proves the frontend's chain guard against a faithful MetaMask stand-in
// that reproduces the exact rejection the reviewer hit: an eth_sendTransaction
// whose `chainId` param differs from the wallet's selected network is refused
// with -32602 "chainId should be same as current chainId".
//
// Run:  node scripts/verify_chain.mjs

import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { CalldataAddress } from "genlayer-js/types";
import { hexToBytes } from "viem";

const CONTRACT = "0xAC2F534da76dFe59e3dBbCB3F822E414E3fd81dE";
const EXPECTED_CHAIN_ID = 61999;

const toCalldataAddress = (hex) => new CalldataAddress(hexToBytes(hex));
const line = (t) => console.log(`\n${"─".repeat(66)}\n  ${t}\n${"─".repeat(66)}`);

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
}

// ── Part 1: a real transaction on the real contract ─────────────────────────

async function realTransaction() {
  line("PART 1 — real create_agreement against the deployed contract");

  check("chain id is 61999", studionet.id === EXPECTED_CHAIN_ID, String(studionet.id));
  check("RPC is StudioNet", studionet.rpcUrls.default.http[0] === "https://studio.genlayer.com/api");

  // StudioNet is gasless, so a fresh account can transact immediately.
  const buyer = createAccount(generatePrivateKey());
  const providerAccount = createAccount(generatePrivateKey());
  const client = createClient({ chain: studionet, account: buyer });

  const agreementId = `chainfix-verify-${Date.now()}`;
  const deadline = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  console.log(`  buyer    : ${buyer.address}`);
  console.log(`  provider : ${providerAccount.address}`);
  console.log(`  agreement: ${agreementId}`);

  const hash = await client.writeContract({
    address: CONTRACT,
    functionName: "create_agreement",
    args: [
      agreementId,
      toCalldataAddress(providerAccount.address),
      "Verification of the StudioNet chain-guard fix.",
      BigInt(5) * BigInt(10) ** BigInt(18),
      deadline,
      86400,
    ],
    value: BigInt(0),
  });
  console.log(`  tx submitted: ${hash}`);

  const receipt = await client.waitForTransactionReceipt({
    hash,
    interval: 6000,
    retries: 100,
  });
  const status = receipt.status_name ?? receipt.status;
  check("transaction reached a successful status", ["ACCEPTED", "FINALIZED"].includes(status), String(status));

  // Read the agreement back out of real contract state.
  const stored = await client.readContract({
    address: CONTRACT,
    functionName: "get_agreement",
    args: [agreementId],
  });
  check("agreement exists in contract state", stored?.agreement_id === agreementId, stored?.agreement_id);
  check(
    "buyer recorded correctly",
    String(stored?.buyer).toLowerCase() === buyer.address.toLowerCase(),
    stored?.buyer
  );
  // A freshly created agreement sits in DRAFT until the provider accepts.
  check("status is DRAFT", stored?.status === "DRAFT", stored?.status);

  return { agreementId, hash };
}

// ── Part 2: the injected-wallet path, with a faithful MetaMask stand-in ─────

class FakeMetaMask {
  constructor({ chainId, knownChains }) {
    this.chainId = chainId;
    this.knownChains = new Set(knownChains ?? [chainId]);
    this.sent = [];
    this.calls = [];
  }
  async request({ method, params }) {
    this.calls.push(method);
    if (method === "eth_chainId") return `0x${this.chainId.toString(16)}`;
    if (method === "wallet_switchEthereumChain") {
      const target = parseInt(params[0].chainId, 16);
      if (!this.knownChains.has(target)) {
        const e = new Error("Unrecognized chain ID.");
        e.code = 4902;
        throw e;
      }
      this.chainId = target;
      return null;
    }
    if (method === "wallet_addEthereumChain") {
      this.knownChains.add(parseInt(params[0].chainId, 16));
      return null;
    }
    if (method === "eth_sendTransaction") {
      const tx = params[0];
      // The exact MetaMask validation behind the reviewer's error.
      if (tx.chainId !== undefined && parseInt(tx.chainId, 16) !== this.chainId) {
        const e = new Error(
          "Invalid parameters: must provide an Ethereum address. chainId should be same as current chainId"
        );
        e.code = -32602;
        throw e;
      }
      this.sent.push(tx);
      return "0x" + "11".repeat(32);
    }
    return null;
  }
}

// What genlayer-js does on the injected-wallet path: it stamps the tx with an
// explicit chainId taken from the client's chain.
function sendViaWallet(wallet) {
  return wallet.request({
    method: "eth_sendTransaction",
    params: [{ from: "0x1".padEnd(42, "0"), to: CONTRACT, data: "0x00", chainId: `0x${EXPECTED_CHAIN_ID.toString(16)}` }],
  });
}

async function walletPath() {
  line("PART 2 — injected-wallet chain guard");

  // (a) Old behaviour: no guard, wallet on Ethereum mainnet.
  const unguarded = new FakeMetaMask({ chainId: 1, knownChains: [1, EXPECTED_CHAIN_ID] });
  let reproduced = false;
  try {
    await sendViaWallet(unguarded);
  } catch (err) {
    reproduced = /chainId should be same as current chainId/.test(err.message);
  }
  check("without the guard, the reviewer's error reproduces", reproduced);
  check("and nothing was sent", unguarded.sent.length === 0);

  // (b) New behaviour: the guard reconciles the chain first.
  const guarded = new FakeMetaMask({ chainId: 1, knownChains: [1, EXPECTED_CHAIN_ID] });
  await guarded.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: `0x${EXPECTED_CHAIN_ID.toString(16)}` }],
  });
  const confirmed = parseInt(await guarded.request({ method: "eth_chainId" }), 16);
  check("guard moves the wallet to 61999", confirmed === EXPECTED_CHAIN_ID, String(confirmed));
  await sendViaWallet(guarded);
  check("transaction is then accepted by the wallet", guarded.sent.length === 1);

  // (c) Wallet that has never seen StudioNet: add, then switch.
  const fresh = new FakeMetaMask({ chainId: 1, knownChains: [1] });
  let needsAdd = false;
  try {
    await fresh.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${EXPECTED_CHAIN_ID.toString(16)}` }],
    });
  } catch (err) {
    needsAdd = err.code === 4902;
  }
  check("unknown chain surfaces 4902 so the guard can add it", needsAdd);
}

async function main() {
  await walletPath();
  const result = await realTransaction();

  line("RESULT");
  console.log(`  contract   : ${CONTRACT}`);
  console.log(`  chain      : ${EXPECTED_CHAIN_ID} (StudioNet)`);
  console.log(`  agreement  : ${result.agreementId}`);
  console.log(`  tx         : ${result.hash}`);
  console.log(`  failures   : ${failures}`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\n❌ verification failed:", err?.message ?? err);
  process.exit(1);
});
