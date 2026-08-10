"use client";

import { CalldataAddress } from "genlayer-js/types";
import type { Address, GenLayerClient, TransactionHash } from "genlayer-js/types";
import { hexToBytes } from "viem";
import type { activeChain } from "./wallet";

// The calldata encoder never auto-detects address-shaped strings -- that's a
// convenience only the `genlayer` CLI's own arg parser does. Any contract
// param typed `Address` (e.g. create_agreement's `provider`, get_reputation's
// `address`) must be passed as an explicit CalldataAddress, or the node
// rejects the call at the calldata-decoding stage before our Python runs.
export function toCalldataAddress(address: Address | string): CalldataAddress {
  return new CalldataAddress(hexToBytes(address as `0x${string}`));
}

// GEN's smallest on-chain unit has 18 decimals, same as ETH/wei. The contract
// requires fund_agreement's value to exactly equal agreed_amount, so both
// must be expressed in this same base unit everywhere they're used.
const GEN_DECIMALS = BigInt(10) ** BigInt(18);

export function genToWei(amountGen: number): bigint {
  // Avoid floating point drift for typical 2-decimal amounts by rounding to
  // whole GEN first; this MVP doesn't need sub-GEN precision in the UI.
  return BigInt(Math.round(amountGen)) * GEN_DECIMALS;
}

export function weiToGen(amountWei: bigint | number | string): number {
  return Number(BigInt(amountWei)) / Number(GEN_DECIMALS);
}

// Filled in after `genlayer deploy` + `genlayer schema <address>` (build step 17-19
// in the project plan). Left blank until the contract is actually deployed so the
// frontend fails loudly instead of silently pointing at nothing.
export const COURTFLOW_ADDRESS = (process.env.NEXT_PUBLIC_COURTFLOW_ADDRESS ??
  "") as Address;

type Client = GenLayerClient<typeof activeChain>;

function requireDeployedAddress(): Address {
  if (!COURTFLOW_ADDRESS) {
    throw new Error(
      "NEXT_PUBLIC_COURTFLOW_ADDRESS is not set. Deploy the contract and set the address before calling it."
    );
  }
  return COURTFLOW_ADDRESS;
}

export async function readCourtFlow<T = unknown>(
  client: Client,
  functionName: string,
  args: unknown[] = []
): Promise<T> {
  const address = requireDeployedAddress();
  return client.readContract({
    address,
    functionName,
    args: args as never,
  }) as Promise<T>;
}

export async function writeCourtFlow(
  client: Client,
  functionName: string,
  args: unknown[] = [],
  valueGen: bigint = BigInt(0)
): Promise<TransactionHash> {
  const address = requireDeployedAddress();
  const hash = await client.writeContract({
    address,
    functionName,
    args: args as never,
    value: valueGen,
  });
  return hash as TransactionHash;
}

export async function waitForCourtFlowTx(client: Client, hash: TransactionHash) {
  // StudioNet consensus (5 validators, LLM-backed for judgment) routinely
  // takes well past genlayer-js's default wait window. Match the interval/
  // retries the official CLI uses (5s / 100 retries) rather than timing out
  // on transactions that are actually still succeeding on-chain.
  return client.waitForTransactionReceipt({ hash, interval: 6000, retries: 100 });
}
