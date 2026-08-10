"""
Integration test: the full CourtFlow adjudication flow through real GenLayer
consensus (deploy -> fund -> deliver -> dispute -> respond -> run_judgment ->
settlement), per master-spec item 41.

Requires a live network with real validators. No local Docker/localnet is
available in this environment, so this targets GenLayer StudioNet (see the
`studionet` entry in gltest.config.yaml) rather than localnet -- run with:

    gltest tests/integration/test_adjudication.py -v -s --network studionet

StudioNet is rate-limited (30 req/min, 500 req/hour), so this is deliberately
a single end-to-end test rather than a parametrized suite: the goal is to
prove the real consensus path once, not to exhaustively cover branches
(tests/direct/ already does that against mocked/direct execution). The
studionet block in gltest.config.yaml sets a 10s poll interval to fit inside
that budget; this test adds extra spacing between steps on top of that for
the same reason (each step involves several RPC calls internally: nonce
fetch, submit, poll).
"""

import time

from gltest import get_contract_factory, get_accounts
from gltest.assertions import tx_execution_succeeded
from genlayer_py.types.calldata import CalldataAddress

AGREED_AMOUNT_WEI = 5 * 10**18
TERMS = (
    "Create an original company logo.\n\n"
    "Requirements:\n"
    "1. Original artwork.\n"
    "2. No copyrighted material.\n"
    "3. Follow supplied brand guidelines.\n"
    "4. PNG delivery.\n"
    "5. SVG delivery.\n"
    "6. Editable/source file.\n"
    "7. Delivery before the agreed deadline.\n\n"
    "Payment: 5 GEN\n"
    "Dispute window: 24 hours after delivery."
)

STEP_PAUSE_SECONDS = 15


def test_full_adjudication_flow_reaches_real_consensus():
    accounts = get_accounts()
    assert len(accounts) >= 2, (
        "gltest.config.yaml's studionet network needs at least 2 accounts "
        "(buyer, provider) -- see the `studionet:` entry."
    )
    buyer_account, provider_account = accounts[0], accounts[1]

    factory = get_contract_factory("CourtFlow")
    buyer = factory.deploy(account=buyer_account)
    provider = buyer.connect(provider_account)
    time.sleep(STEP_PAUSE_SECONDS)

    agreement_id = f"integration-{int(time.time())}"
    deadline = time.strftime(
        "%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(time.time() + 7 * 24 * 3600)
    )

    # 1. create_agreement (buyer)
    result = buyer.create_agreement(
        args=[
            agreement_id,
            CalldataAddress(provider_account.address),
            TERMS,
            AGREED_AMOUNT_WEI,
            deadline,
            86400,
        ]
    ).transact()
    assert tx_execution_succeeded(result)
    time.sleep(STEP_PAUSE_SECONDS)

    # 2. accept_agreement (provider)
    result = provider.accept_agreement(args=[agreement_id]).transact()
    assert tx_execution_succeeded(result)
    time.sleep(STEP_PAUSE_SECONDS)

    # 3. fund_agreement (buyer, real GEN escrow)
    result = buyer.fund_agreement(args=[agreement_id]).transact(value=AGREED_AMOUNT_WEI)
    assert tx_execution_succeeded(result)
    time.sleep(STEP_PAUSE_SECONDS)

    agreement = buyer.get_agreement(args=[agreement_id]).call()
    assert agreement["status"] == "FUNDED"
    assert agreement["escrow_deposited"] == AGREED_AMOUNT_WEI
    time.sleep(5)

    # 4. submit_delivery (provider)
    result = provider.submit_delivery(
        args=[
            agreement_id,
            f"del-{agreement_id}",
            ["ipfs://fake-logo.png", "ipfs://fake-logo.svg", "ipfs://fake-logo-source.ai"],
            "Integration test delivery",
        ]
    ).transact()
    assert tx_execution_succeeded(result)
    time.sleep(STEP_PAUSE_SECONDS)

    # 5. open_dispute (buyer)
    result = buyer.open_dispute(
        args=[
            agreement_id,
            agreement_id,
            "The logo contains copyrighted material from a well-known brand.",
        ]
    ).transact()
    assert tx_execution_succeeded(result)
    time.sleep(STEP_PAUSE_SECONDS)

    # 6. respond_to_dispute (provider)
    result = provider.respond_to_dispute(
        args=[
            agreement_id,
            "The logo is fully original artwork, no copyrighted material was used.",
        ]
    ).transact()
    assert tx_execution_succeeded(result)
    time.sleep(STEP_PAUSE_SECONDS)

    dispute = buyer.get_dispute(args=[agreement_id]).call()
    assert dispute["status"] == "UNDER_REVIEW"
    time.sleep(5)

    # 7. run_judgment -- real GenLayer AI-validator consensus
    result = buyer.run_judgment(args=[agreement_id]).transact()
    assert tx_execution_succeeded(result)
    time.sleep(STEP_PAUSE_SECONDS)

    # Verify the judgment is a real, schema-valid, normalized decision -- not
    # raw LLM prose, and that settlement followed the deterministic mapping.
    judgment = buyer.get_judgment(args=[agreement_id]).call()
    assert judgment["decision"] in (
        "FULFILLED",
        "FAILED",
        "PARTIAL",
        "INSUFFICIENT_EVIDENCE",
    )
    assert 0 <= judgment["payout_bps"] <= 10000
    assert isinstance(judgment["summary"], str) and len(judgment["summary"]) > 0

    final_agreement = buyer.get_agreement(args=[agreement_id]).call()
    assert final_agreement["status"] == "SETTLED"
    assert final_agreement["escrow_deposited"] == 0

    # Reputation updated exactly once, only from the finalized settlement.
    reputation = buyer.get_reputation(args=[CalldataAddress(provider_account.address)]).call()
    assert reputation["disputes_opened"] == 1
