# CourtFlow — Response: "chainId should be same as current chainId"

Thank you for the report. The blocker is fixed, deployed, and verified against the
live contract. Below is the root cause, what changed, and the shortest path to
re-test it.

**Fix commit:** [`e8207fb`](https://github.com/Olawalter/courtflow/commit/e8207fb)
**Live app:** https://courtflow-agent.vercel.app
**Contract:** `0xAC2F534da76dFe59e3dBbCB3F822E414E3fd81dE` (GenLayer StudioNet, chain `61999`)

---

## Reported blocker

```
Invalid parameters were provided to the RPC method.
Double check you have provided the correct parameters.

Details: chainId should be same as current chainId
Version: viem@2.55.11
```

---

## 1. Root cause

The app never checked or changed the **wallet's** network. There was no chain
handling anywhere in the frontend — no `eth_chainId`, no `wallet_switchEthereumChain`,
no guard before a write.

genlayer-js's injected-wallet path stamps every transaction with an explicit chain id
taken from its own config (`genlayer-js/dist/index.js`, `eth_sendTransaction` branch):

```js
const formattedRequest = {
  from, to, data, value, gas, nonce,
  type: "0x0",
  chainId: `0x${client.chain.id.toString(16)}`,   // 0xf22f = 61999
  ...
};
await client.request({ method: "eth_sendTransaction", params: [formattedRequest] });
```

MetaMask validates that `chainId` field against its **currently selected** network and
rejects the request with `-32602` when they differ. viem surfaces that as the
`InvalidParamsRpcError` you saw.

So the transaction was never signed and never reached the contract. Any reviewer whose
wallet was on a different network could not transact at all.

**What was NOT wrong**, having checked each one:

| Layer | Value | Status |
|---|---|---|
| Frontend chain config | `studionet` → `61999` | correct |
| genlayer-js client | `61999` | correct |
| viem client | `61999` | correct |
| RPC endpoint | `https://studio.genlayer.com/api` | correct |
| Contract address | `0xAC2F534d…81dE` | correct |
| **Vercel production env** | address + `61999` + RPC baked into the live bundle | **correct — no changes needed** |

The mismatch was never between our own layers. It was between the app (always 61999)
and the wallet's selected network (whatever the user happened to be on).

Two `wallet_switchEthereumChain` strings did exist in the old production bundle, but
both were unreachable library code: viem's internal primitive, and genlayer-js's
`connect()` helper, which requires the MetaMask **Snap** (`wallet_getSnaps`) and is
never called by CourtFlow. Adopting it would have broken plain MetaMask and Rabby.

---

## 2. The fix

A single guard, `ensureActiveChain()`, reconciles the wallet **before** the
transaction is built:

```
read wallet chain
  ├─ already 61999 ────────────────────────────────► proceed
  └─ otherwise
       wallet_switchEthereumChain (EIP-3326)
         └─ 4902 (wallet has never seen the chain)
              wallet_addEthereumChain (EIP-3085)  → switch again
       re-read the chain and confirm it is 61999
         ├─ confirmed ──────────────────────────────► proceed
         └─ anything else ─► throw WrongNetworkError, send nothing
```

Three details worth calling out:

- **The chain is re-read after the switch.** A wallet that resolves
  `wallet_switchEthereumChain` without actually switching must not slip through, so
  the switch call's own resolution is never trusted on its own.
- **The guard sits in `writeCourtFlow`** — the single chokepoint every state-changing
  method funnels through — so all 11 writes are covered (`create_agreement`,
  `fund_agreement`, `run_judgment`, `open_dispute`, …), not just the one reported.
- **One source of truth.** Chain id, RPC URL, network label and the EIP-3085
  add-chain parameters are all derived from a single genlayer-js chain object in
  `frontend/src/lib/genlayer/network.ts`, so the wallet, the client and the
  transaction cannot drift apart again.

If the chain cannot be reconciled, nothing is submitted and the user gets an explicit
message ("Wrong network — please switch your wallet to Genlayer Studio Network
(chain 61999)") with a one-click switch button, rather than an RPC error at submit
time. Reads still use the chain's own RPC, so browsing works on any network.

---

## 3. Files changed

| File | Why |
|---|---|
| `frontend/src/lib/genlayer/network.ts` | **new** — authoritative chain config + `ensureActiveChain()` |
| `frontend/src/lib/genlayer/contract.ts` | guard applied at the single write chokepoint |
| `frontend/src/lib/genlayer/wallet.ts` | tracks `chainId`/`wrongNetwork`, reconciles at connect, syncs on `chainChanged`, exposes `switchNetwork()` |
| `frontend/src/lib/genlayer/readClient.ts` | reads go via the chain RPC, so they work on any wallet network |
| `frontend/src/components/NetworkBanner.tsx` | **new** — wrong-network banner with a switch action |
| `frontend/src/components/WalletConnectButton.tsx` | shows wrong-network state |
| `frontend/src/app/agreements/new/page.tsx`, `agreements/[id]/page.tsx`, `disputes/[id]/page.tsx` | banner on every write surface |
| `frontend/tests/` + `vitest.config.ts` | regression suite (below) |
| `frontend/scripts/verify_chain.mjs` | reproducible live verification |

---

## 4. Tests

```bash
cd frontend
npm run lint && npx tsc --noEmit    # clean
npm test                            # 15/15 passing
npm run build                       # succeeds

cd .. && pytest tests/direct -q     # 79/79 passing (contract suite, unchanged)
```

The suite drives a MetaMask stand-in that reproduces the exact `-32602` rejection, so
it fails the same way your browser did if the guard ever regresses:

| Scenario | Assertion |
|---|---|
| Wallet already on 61999 | transaction proceeds; no needless switch prompt |
| Wallet on the wrong chain | **no transaction sent**; switch requested; clear error |
| Switch → revalidate → proceed | chain re-read *after* the switch, *before* the send |
| Wallet has never seen StudioNet | `wallet_addEthereumChain` with correct params, then send |
| User rejects the add-chain prompt | no transaction sent |
| Wallet reports a switch but doesn't switch | no transaction sent |
| Correct contract address | write targets `0xAC2F534d…81dE` |
| All 10 other write methods | each blocked on a wrong chain |

The tests were mutation-checked: removing `await ensureActiveChain()` fails **9 of 15**,
so a regression cannot pass silently.

---

## 5. Live verification

**A real `create_agreement` on the deployed contract** (`node frontend/scripts/verify_chain.mjs`):

```
tx        0x2c4560fc66851432f7798eac4b1c219871ee478aa33832029df199a6dbd415d6
status    ACCEPTED
readback  get_agreement -> id chainfix-verify-1786801178287, status DRAFT,
          buyer matches the sender
```

**The built UI, wallet on the wrong chain (chain 1):**

```
rpc during the write attempt : eth_chainId -> wallet_switchEthereumChain (declined)
transactions sent            : 0            <- eth_sendTransaction never attempted
user sees                    : "You declined the network switch. Switch your wallet to
                                Genlayer Studio Network (chain 61999) to continue."
agreement state              : unchanged
```

**Same UI after accepting the switch:**

```
rpc          : eth_chainId -> wallet_switchEthereumChain -> eth_chainId (re-verify)
then         : eth_chainId -> eth_sendTransaction  (accepted, no -32602)
tx           : 0xbc186eb05e6fd6b0008d998612cea4ff6e1b87711e6debbcdd895a963ac02bc6
status       : Finalized
on-chain     : agreement ui-guard-1786805432578  DRAFT -> CANCELLED
```

**Live production site** (`courtflow-agent.vercel.app`, after deploy): same three
phases reproduced — blocked on chain 1 with zero transactions attempted, the
add-chain prompt carrying the correct StudioNet parameters
(`0xf22f`, GEN, `https://studio.genlayer.com/api`), then after switching an
`eth_sendTransaction` **accepted with `chainId: 0xf22f`** and **zero chainId
rejections** across the whole run.

**Honest limitations.** Browser automation has no wallet extension, so signing was
performed by a local key behind an EIP-1193 provider that enforces MetaMask's real
chainId validation. On the HTTPS production site, mixed-content policy blocked that
local signer, so the live run validated the wallet's acceptance of the transaction
rather than broadcasting it; the actual broadcasts are the two transaction hashes
above. Separately, react-hook-form does not accept programmatic value injection, so
the UI runs exercised the guard through the agreement page's action button — the
identical `writeCourtFlow` path — rather than the create form. Real typing is
unaffected, which is why your session reached the RPC error in the first place.

---

## 6. How to re-test (shortest path)

1. Open https://courtflow-agent.vercel.app/agreements/new
2. Set your wallet to **any network other than StudioNet**, then connect.
   You should see a **"Wrong network"** banner naming chain `61999` — not a silent failure.
3. Click **Switch to Genlayer Studio Network** and approve the add/switch prompt.
4. Fill the form and click **Create Agreement** — it signs and finalizes.

The original error cannot occur now: if the chain cannot be reconciled, no transaction
is built at all.

---

## 7. What was deliberately not done

- No mocked contract, no faked or hardcoded transaction result, no bypassed signing.
- No contract logic moved into the frontend and no custom backend; the GenLayer
  Intelligent Contract remains the source of truth for every decision and payout.
- No second wallet architecture (the Snap-based `connect()` path was rejected for
  the reasons above).
- The adjudication model, contract, and its 79 tests are untouched — this was a
  frontend wallet-integration defect.
