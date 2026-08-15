# CourtFlow

**The Adjudication Layer for Agentic Commerce**

> What happens when two agents disagree about whether a promise was fulfilled?

CourtFlow is a trustless adjudication protocol for autonomous-agent commerce, built on
GenLayer. Two agents create an agreement, lock payment in escrow, exchange a
deliverable, and — if they disagree about whether it was fulfilled — send the
contested commitment through GenLayer's decentralized AI-validator consensus for a
structured judgment that automatically settles escrow.

MVP scope: a single concrete case — an AI Logo Design Agreement (buyer hires provider
for an original logo; buyer disputes on copyright grounds; GenLayer adjudicates).

**Status: working end-to-end**, verified through three independent paths — the
formal `gltest` integration suite, a scripted run against `genlayer-js`, and manual
testing through the actual browser UI with a real injected wallet — all reaching a
real GenLayer consensus judgment and automatic settlement. See
[Verification](#verification) below.

**New here?** Read [`docs/submission-notes.md`](docs/submission-notes.md) first — a
plain-language explanation of what this actually does and why it needed GenLayer
specifically, without the marketing language.

## Live deployment

| | |
|---|---|
| Frontend | **[courtflow-agent.vercel.app](https://courtflow-agent.vercel.app)** |
| Network | GenLayer StudioNet (chain ID `61999`) |
| Contract address | [`0xAC2F534da76dFe59e3dBbCB3F822E414E3fd81dE`](https://genlayer-explorer.vercel.app/address/0xAC2F534da76dFe59e3dBbCB3F822E414E3fd81dE) |
| Includes | Both security-review fixes (`claim_delivery_timeout`, settlement-before-status-write ordering) plus a live `gl.nondet.web` reachability check in the judgment pipeline |

The live frontend is wired to this exact contract and reads/writes it directly —
open it, connect an injected wallet on StudioNet, and walk through the
[demo workflow](#demo-workflow). It's the same contract `genvm-lint check` /
`genlayer schema` were last run against, and already has real settled agreements on
it from testing (see [Verification](#verification)).

## Why GenLayer

A normal EVM contract can move money based on explicit state, but it cannot decide
"does this logo contain copyrighted material?" — that requires judgment. GenLayer's
Intelligent Contracts can call an LLM as part of consensus (Optimistic Democracy):
the leader validator produces a judgment, and other validators check that judgment
against an explicit equivalence principle rather than trusting one node's opinion.
See [`docs/adjudication-model.md`](docs/adjudication-model.md) for exactly which
primitive we use and why.

## Architecture

```
Next.js Frontend (frontend/) ── genlayer-js, injected wallet (MetaMask/Rabby/etc.)
        │
        ▼
GenLayer Chain → GenVM → Intelligent Contract (contracts/courtflow.py)
```

No custom backend. See [`docs/architecture.md`](docs/architecture.md) for the full
system design, [`docs/contract-spec.md`](docs/contract-spec.md) for the state machine,
storage model, escrow custody rules, and payout paths,
[`docs/adjudication-model.md`](docs/adjudication-model.md) for the judgment pipeline,
and [`docs/security-review.md`](docs/security-review.md) for the security pass and
what it changed.

## Repository layout

```
contracts/courtflow.py        Intelligent Contract (GenVM v0.3.0-rc7 SDK)
tests/direct/                 In-process unit tests -- 79 tests, all passing
tests/integration/            Real-consensus test against a live network (gltest) -- passing
frontend/                     Next.js app
frontend/src/lib/genlayer/network.ts  Single source of truth for chain id/RPC + the wallet chain guard
frontend/tests/               Frontend tests (vitest) -- wallet chain guard, 15 tests
frontend/scripts/e2e_demo.mjs Scripted end-to-end run via genlayer-js (see below)
frontend/scripts/verify_chain.mjs  Chain-guard verification + a real create_agreement on the live contract
docs/                         architecture, contract spec, adjudication model, security review
gltest.config.example.yaml    template -- copy to gltest.config.yaml and fill in your own keys
```

## Verified toolchain

| Tool | Version |
|---|---|
| `genlayer` CLI | 0.39.2 |
| `genlayer-py` (client SDK) | 0.16.3 |
| `genlayer-js` (frontend) | 1.2.0 |
| `genlayer-test` / `gltest` | 0.29.2 |
| `genvm-lint` | 0.11.0 |
| GenVM contract SDK (what the contract is written against) | v0.3.0-rc7 |

Every contract-side API used here (`gl.public.write.payable`, `gl.message.value`,
sending GEN to an EOA via `gl.evm.contract_interface`, `gl.eq_principle.prompt_non_comparative`,
`gl.vm.UserError`, storage types) was verified by extracting and reading the actual
GenVM v0.3.0-rc7 SDK source, then confirmed against real StudioNet deploys — several
plausible-looking APIs (`gl.Account`, `gl.chain.Account`, `gl.get_contract_at`) turned
out not to work for sending GEN to a plain address on the live network and are
documented as dead ends rather than silently avoided.

## Setup

```bash
pip install -r requirements.txt   # genlayer-test, etc.
npm install -g genlayer           # CLI
cd frontend && npm install
```

Copy `gltest.config.example.yaml` to `gltest.config.yaml` and fill in your own private
keys (never commit real keys — `gltest.config.yaml` is gitignored on purpose).

## Testing

```bash
genvm-lint check contracts/courtflow.py --json   # structural + SDK validation, clean
pytest tests/direct/ -v                          # 79/79 passing
gltest tests/integration/test_adjudication.py -v -s --network studionet

cd frontend
npm run lint && npx tsc --noEmit                 # clean
npm test                                         # 15/15 passing (wallet chain guard)
node scripts/verify_chain.mjs                    # real create_agreement on the live contract
```

The integration test runs the complete lifecycle — including a real
`run_judgment` consensus call — against a live network, and passes
(`1 passed in 1447.98s`, i.e. ~24 minutes, dominated by StudioNet's rate-limit
pacing rather than actual consensus time). It targets StudioNet because no local
Docker/localnet was available while building this; StudioNet rate-limits
aggressively (30 req/min, 500 req/hour) so the test paces itself with deliberate
delays between steps and is intentionally a single end-to-end run rather than a
parametrized suite (the 74 direct tests already cover branch/edge-case behavior
against mocked execution).

## Deployment

To use the [live deployment](#live-deployment) above, just point `frontend/.env.local`
at it (see below) and skip straight to [Running the frontend](#running-the-frontend).

To deploy your own instead:

```bash
genlayer network set studionet     # or another built-in network
genlayer deploy --contract contracts/courtflow.py
genlayer schema <address>          # inspect before wiring the frontend
```

Then set `frontend/.env.local` (copy from `frontend/.env.local.example`):

```
NEXT_PUBLIC_GENLAYER_CHAIN=studionet
NEXT_PUBLIC_COURTFLOW_ADDRESS=<your deployed address, or 0xAC2F534da76dFe59e3dBbCB3F822E414E3fd81dE for the live one>
```

## Running the frontend

```bash
cd frontend
npm run dev
```

Every write goes through `frontend/src/lib/genlayer/useTxStatus.ts`, which surfaces the
actual stages of a GenLayer transaction rather than a generic spinner: waiting for the
wallet to sign, submitted, awaiting validator consensus, then finalized or failed
(with the real error) — this is user-visible in the status banner on the agreement and
dispute pages, not just internal state.

Connect an injected wallet (MetaMask/Rabby). You do **not** have to add or select the
network by hand: the app reconciles the wallet's chain before every state-changing
call — it asks the wallet to switch to the configured network, adds the network first
if the wallet has never seen it, then re-reads the chain and only proceeds once it is
confirmed. If you decline the switch, the write is refused with an explicit
"wrong network" message rather than being submitted and failing at the RPC.

This matters because genlayer-js stamps each transaction with an explicit `chainId`,
and wallets reject a transaction whose `chainId` doesn't match their currently
selected network (`chainId should be same as current chainId`). Reconciling the chain
up front is what keeps that error from reaching the user.

The target network comes from `NEXT_PUBLIC_GENLAYER_CHAIN` (StudioNet: chain ID
`61999`, RPC `https://studio.genlayer.com/api`); chain id, RPC and the wallet
add/switch parameters are all derived from that single value in
`frontend/src/lib/genlayer/network.ts`. Reads don't need a wallet at all, so browsing
works on any network.

Two distinct accounts are needed to exercise a full agreement (buyer + provider) —
switch between them in the wallet as you move through the lifecycle.

## Verification

The full lifecycle — create → accept → fund escrow → deliver → dispute → respond →
**real GenLayer consensus judgment** → automatic settlement → reputation update — has
been run to completion multiple times on StudioNet, through every layer of the stack:

- **`gltest tests/integration/test_adjudication.py`** — the official GenLayer test
  framework, real consensus, `1 passed`.
- **Scripted**, via `frontend/scripts/e2e_demo.mjs` (uses `genlayer-js` directly, since
  the `genlayer` CLI's `write` command has no `--value` flag and can't call payable
  methods):
  ```bash
  cd frontend
  BUYER_PRIVATE_KEY=0x... node scripts/e2e_demo.mjs
  ```
- **Manually**, through the actual browser UI with a real injected wallet, twice
  independently.

A real judgment produced during testing:

```json
{
  "decision": "INSUFFICIENT_EVIDENCE",
  "payout_bps": 10000,
  "reason_codes": ["UNSUBSTANTIATED_CLAIM", "DEADLINE_MET", "REQUIREMENTS_DELIVERED"],
  "summary": "The buyer claims the logo contains copyrighted material but provided no evidence or specific brand references to support the allegation. The provider delivered all required file formats (PNG, SVG, source) before the deadline and asserts originality. As the burden of proof rests on the claimant, the lack of evidence necessitates a decision in favor of the provider."
}
```

Escrow settled automatically per that decision — no manual intervention, no custom
backend, just the Intelligent Contract acting on the finalized consensus result.

### Live data in the judgment pipeline

Judgment isn't limited to reasoning over evidence the parties submitted. Before
building the case for the LLM, the contract independently checks — via
`gl.nondet.web.head()` — whether a delivered file reference actually resolves over
HTTP(S), and folds that result into the evidence as
`delivery_url_reachability_check`. This is a real non-deterministic web call inside
the `prompt_non_comparative` equivalence-principle closure (leader and every
validator each re-run it independently, per GenLayer's Optimistic Democracy model),
not a documented-but-unused capability. See
[`docs/adjudication-model.md`](docs/adjudication-model.md) for why it's scoped to
HTTP(S) refs only (our own demo data uses `ipfs://` references, which report
`"not checked"` rather than a false negative).

## Security review

A dedicated pass (see [`docs/security-review.md`](docs/security-review.md)) checked
the contract against the standard escrow/agreement/dispute/judgment/reputation attack
surface. Two real findings, both fixed:

1. **Stuck funds**: no recovery path existed if the buyer went silent after delivery
   (the contract protected against an unresponsive *provider* but not an unresponsive
   *buyer*). Fixed with `claim_delivery_timeout`, symmetric to the existing
   `claim_timeout`.
2. **Settlement ordering fragility**: `run_judgment` recorded the judgment/dispute
   status before calling settlement; reordered so settlement happens first, so a
   hypothetical future failure there leaves the dispute retryable instead of stuck.

## Demo workflow

Buyer creates agreement → provider accepts → buyer funds 5 GEN → provider delivers →
buyer opens dispute (copyright claim) → provider responds → evidence assembled →
GenLayer consensus → judgment finalizes → escrow settles automatically → reputation
updates once.
