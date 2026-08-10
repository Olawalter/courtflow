# Submission notes

**What this is:** an escrow contract for two AI agents doing business with each
other, where a third party — GenLayer's validator network — steps in to decide who's
right if they disagree, and the money moves automatically based on that decision.

**The concrete problem:** two agents agree that Agent B will make a logo for Agent A
for 500 GEN. Agent A pays into escrow up front (has to trust Agent B will deliver).
Agent B delivers. Agent A says "this looks copied, I'm not paying." Agent B says "no,
it's original." Nobody involved — not the buyer, not the provider, not a smart
contract running plain code — can settle that by itself, because it's a judgment call
about the actual content of the delivery, not a fact you can check with an if-statement.

**What GenLayer actually does here, concretely:** when `run_judgment` is called, the
contract hands a structured case (the agreement terms, the buyer's claim, the
provider's response, the delivery's file references, whether the deadline was met) to
GenLayer's validator set. One validator (the leader) reasons over it and produces a
decision. The other validators don't just trust that — they independently check
whether the leader's decision holds up against explicit criteria we wrote into the
contract (is the decision one of the four allowed values, is the payout percentage
internally consistent with the decision, are the stated reasons actually grounded in
the case). Only if that check passes does consensus finalize, and only then does the
contract read the finalized decision and split the escrow accordingly. The LLM never
touches the money directly — it's not `if llm_says_ok: send(money)`, it's
`llm_decision -> validated by consensus -> deterministic bps mapping we wrote ->
transfer`.

**Why this had to be GenLayer and not a normal EVM contract plus an API call to an
LLM:** a plain contract calling out to a single LLM API would mean one node's opinion
silently becomes financial fact — no way for anyone else to check that opinion, and a
single point of failure/manipulation for real money. GenLayer's consensus is what
turns "a model said so" into something a contract can actually trust enough to release
funds on.

**How to actually use it:** see the main [README](../README.md) for setup and running
it. Short version: deploy the contract, connect an injected wallet (MetaMask/Rabby) in
the frontend, and walk through create agreement → provider accepts → buyer funds
escrow → provider delivers → buyer disputes → provider responds → either party
triggers judgment → GenLayer decides → escrow settles. This exact flow has been run to
completion multiple times against a live network (StudioNet) with a real judgment
coming back and real funds moving, documented with the actual output in the README's
[Verification](../README.md#verification) section — it's not a mockup.

**What's genuinely MVP-scoped, stated plainly rather than hidden:**
- One dispute case is implemented (logo design / copyright claim), not a general
  arbitrary-dispute engine. The contract's judgment prompt and evidence structure are
  specific to this case; extending to other case types means writing new
  `JUDGMENT_TASK`/`JUDGMENT_CRITERIA` text and evidence fields, not new architecture.
- The judgment doesn't call out to live web data (see
  [`docs/adjudication-model.md`](adjudication-model.md) for exactly why, and where
  that would plug in for a case that needed it).
- `tests/integration/` is one deliberately-paced end-to-end test rather than a
  parametrized suite, because the only live network available while building this
  (GenLayer StudioNet) rate-limits at 30 requests/minute — it still exercises the real
  consensus path, it's just not exhaustive the way the 74 `tests/direct/` tests are.
