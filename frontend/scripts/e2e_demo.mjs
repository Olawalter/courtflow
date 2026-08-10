// End-to-end demo runner against the real deployed CourtFlow contract on StudioNet.
// Drives: create -> accept -> fund -> deliver -> dispute -> respond -> judgment -> settlement.
// Uses genlayer-js directly (not the frontend UI) because `genlayer write` CLI has no
// --value flag, so it can't call payable methods like fund_agreement.

import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { CalldataAddress } from "genlayer-js/types";
import { hexToBytes } from "viem";
import util from "node:util";

// genlayer-js's calldata encoder never auto-detects address-shaped strings --
// that convenience only exists in the `genlayer` CLI's own arg parser. Contract
// params typed `Address` (like create_agreement's `provider`) must be passed
// as an explicit CalldataAddress, or the node rejects the call at the
// calldata-decoding stage with a generic "execution failed" before our Python
// code even runs.
function toCalldataAddress(hexAddress) {
  return new CalldataAddress(hexToBytes(hexAddress));
}

const CONTRACT = "0x4D921d5C3c5eEae8b4bE00896E47Fb0142c69470";
const BUYER_PK = process.env.BUYER_PRIVATE_KEY;
if (!BUYER_PK) {
  console.error("Set BUYER_PRIVATE_KEY env var");
  process.exit(1);
}

const buyerAccount = createAccount(BUYER_PK);
const providerPk = generatePrivateKey();
const providerAccount = createAccount(providerPk);

const buyer = createClient({ chain: studionet, account: buyerAccount });
const provider = createClient({ chain: studionet, account: providerAccount });

const AGREEMENT_ID = `logo-design-${Date.now()}`;
// agreed_amount and fund_agreement's value must be denominated identically
// (both u256, GEN's smallest unit == wei, 18 decimals) since the contract
// requires exact equality between them.
const AGREED_AMOUNT_GEN = 5; // small amount for the demo, in whole GEN
const AGREED_AMOUNT_WEI = BigInt(AGREED_AMOUNT_GEN) * BigInt(10) ** BigInt(18);
const TERMS = `Create an original company logo.

Requirements:
1. Original artwork.
2. No copyrighted material.
3. Follow supplied brand guidelines.
4. PNG delivery.
5. SVG delivery.
6. Editable/source file.
7. Delivery before the agreed deadline.

Payment: ${AGREED_AMOUNT_GEN} GEN
Dispute window: 24 hours after delivery.`;

function log(step, data) {
  console.log(`\n=== ${step} ===`);
  if (data !== undefined) console.log(JSON.stringify(data, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// StudioNet rate-limits at 30 req/min. Space out steps and poll receipts
// slowly (matching the official CLI's own interval/retries) so a run never
// dies to rate limiting instead of a real failure.
function decodeLeaderError(receipt) {
  const leader = receipt?.consensus_data?.leader_receipt?.[0];
  if (!leader) return null;
  if (leader.execution_result === "SUCCESS" || leader.execution_result === "RETURN") {
    return null;
  }
  return {
    execution_result: leader.execution_result,
    stderr: leader.genvm_result?.stderr,
    error_code: leader.genvm_result?.error_code,
    raw_error: leader.genvm_result?.raw_error,
    result: leader.result,
  };
}

async function writeAndWait(client, functionName, args, value = BigInt(0)) {
  const hash = await client.writeContract({
    address: CONTRACT,
    functionName,
    args,
    value,
  });
  const receipt = await client.waitForTransactionReceipt({
    hash,
    interval: 10000,
    retries: 100,
  });
  const failure = decodeLeaderError(receipt);
  if (failure) {
    console.error(`\n!!! ${functionName} FAILED on-chain !!!`);
    console.error(util.inspect(failure, { depth: null }));
    throw new Error(`${functionName} failed: ${JSON.stringify(failure)}`);
  }
  await sleep(15000);
  return { hash, receipt };
}

async function readAndPace(client, functionName, args) {
  const result = await client.readContract({ address: CONTRACT, functionName, args });
  await sleep(8000);
  return result;
}

async function main() {
  // Give StudioNet's 30 req/min window a clean start before hammering it.
  await sleep(20000);
  log("Buyer address", buyerAccount.address);
  log("Provider address (freshly generated)", providerAccount.address);
  log("Provider private key (save if you want to reuse this account)", providerPk);
  // StudioNet is gasless, so the freshly generated provider account needs no
  // GEN balance to submit transactions -- skipping the funding step.

  log("1. create_agreement (buyer)");
  const deadline = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  await writeAndWait(buyer, "create_agreement", [
    AGREEMENT_ID,
    toCalldataAddress(providerAccount.address),
    TERMS,
    AGREED_AMOUNT_WEI,
    deadline,
    24 * 3600,
  ]);
  log("agreement after create", await readAndPace(buyer, "get_agreement", [AGREEMENT_ID]));

  log("2. accept_agreement (provider)");
  await writeAndWait(provider, "accept_agreement", [AGREEMENT_ID]);

  log("3. fund_agreement (buyer, value = agreed amount)");
  await writeAndWait(buyer, "fund_agreement", [AGREEMENT_ID], AGREED_AMOUNT_WEI);
  log("agreement after funding", await readAndPace(buyer, "get_agreement", [AGREEMENT_ID]));

  log("4. submit_delivery (provider)");
  await writeAndWait(provider, "submit_delivery", [
    AGREEMENT_ID,
    `del-${AGREEMENT_ID}`,
    ["ipfs://fake-logo.png", "ipfs://fake-logo.svg", "ipfs://fake-logo-source.ai"],
    "Final logo delivery",
  ]);
  log("agreement after delivery", await readAndPace(buyer, "get_agreement", [AGREEMENT_ID]));

  log("5. open_dispute (buyer)");
  await writeAndWait(buyer, "open_dispute", [
    AGREEMENT_ID,
    AGREEMENT_ID,
    "The logo contains copyrighted material from a well-known brand.",
  ]);

  log("6. respond_to_dispute (provider)");
  await writeAndWait(provider, "respond_to_dispute", [
    AGREEMENT_ID,
    "The logo is fully original artwork created from scratch, following the supplied brand guidelines. No copyrighted material was used.",
  ]);
  log("dispute after response", await readAndPace(buyer, "get_dispute", [AGREEMENT_ID]));

  log("7. run_judgment (buyer triggers) -- this is the real GenLayer consensus call, may take a while");
  const judgmentResult = await writeAndWait(buyer, "run_judgment", [AGREEMENT_ID]);
  log("run_judgment receipt status", judgmentResult.receipt.status_name ?? judgmentResult.receipt.status);

  log("Final agreement state", await readAndPace(buyer, "get_agreement", [AGREEMENT_ID]));
  log("Judgment", await readAndPace(buyer, "get_judgment", [AGREEMENT_ID]));
  log(
    "Provider reputation",
    await readAndPace(buyer, "get_reputation", [toCalldataAddress(providerAccount.address)])
  );
}

main().catch((err) => {
  console.error("\n=== FAILED ===");
  console.error(err);
  console.error("\n=== FULL ERROR DETAIL ===");
  console.error(util.inspect(err, { depth: null, maxArrayLength: null }));
  process.exit(1);
});
