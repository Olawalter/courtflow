"""
Judgment tests.

gl.eq_principle.prompt_non_comparative delegates the actual LLM call to the
framework's internal ExecPromptTemplate machinery, which gltest's direct-mode
WASI mock (genlayer-test 0.29.2) does not yet intercept -- only plain
gl.nondet.exec_prompt ("ExecPrompt") is mockable there. Exercising the full
run_judgment() consensus path therefore belongs in tests/integration (real
GenVM/localnet), per the master spec's own direct-vs-integration split.

These tests instead directly exercise the two units that decide correctness:
_parse_and_validate_judgment (LLM output resilience) and _settle_from_judgment
(the deterministic decision -> payout_bps -> GEN split mapping), which is
exactly what "verify each maps to the correct deterministic settlement" (spec
item 40) requires and does not depend on the mocking gap above.
"""

import json

import pytest

from .conftest import AGREED_AMOUNT, create_and_accept, deliver, fund


def _judged_agreement(direct_vm, deploy, buyer, provider):
    contract = deploy
    create_and_accept(direct_vm, contract, buyer, provider)
    fund(direct_vm, contract, buyer, "agr-1")
    deliver(direct_vm, contract, provider, "agr-1")
    return contract


# ---- _parse_and_validate_judgment: LLM resilience ----------------------


def test_valid_fulfilled_judgment_parses(direct_vm, deploy):
    contract = deploy
    raw = json.dumps({
        "decision": "FULFILLED", "payout_bps": 10000,
        "reason_codes": ["ORIGINALITY_OK"], "summary": "Looks original.",
    })
    j = contract._parse_and_validate_judgment(raw)
    assert j.decision == "FULFILLED"
    assert j.payout_bps == 10000


def test_non_json_output_reverts(direct_vm, deploy):
    contract = deploy
    with direct_vm.expect_revert():
        contract._parse_and_validate_judgment("not json at all")


def test_non_object_json_reverts(direct_vm, deploy):
    contract = deploy
    with direct_vm.expect_revert():
        contract._parse_and_validate_judgment(json.dumps(["FULFILLED", 10000]))


def test_invalid_decision_enum_reverts(direct_vm, deploy):
    contract = deploy
    raw = json.dumps({
        "decision": "MAYBE", "payout_bps": 5000, "reason_codes": [], "summary": "x",
    })
    with direct_vm.expect_revert():
        contract._parse_and_validate_judgment(raw)


def test_payout_bps_out_of_range_reverts(direct_vm, deploy):
    contract = deploy
    raw = json.dumps({
        "decision": "PARTIAL", "payout_bps": 15000, "reason_codes": [], "summary": "x",
    })
    with direct_vm.expect_revert():
        contract._parse_and_validate_judgment(raw)


def test_payout_bps_not_an_integer_reverts(direct_vm, deploy):
    contract = deploy
    raw = json.dumps({
        "decision": "PARTIAL", "payout_bps": "half", "reason_codes": [], "summary": "x",
    })
    with direct_vm.expect_revert():
        contract._parse_and_validate_judgment(raw)


def test_fulfilled_decision_forces_10000_bps_regardless_of_llm_value(direct_vm, deploy):
    """The contract, not the LLM, is authoritative for non-PARTIAL bps."""
    contract = deploy
    raw = json.dumps({
        "decision": "FULFILLED", "payout_bps": 4000,  # LLM sent a bogus/malicious value
        "reason_codes": [], "summary": "x",
    })
    j = contract._parse_and_validate_judgment(raw)
    assert j.payout_bps == 10000


def test_failed_decision_forces_0_bps_regardless_of_llm_value(direct_vm, deploy):
    contract = deploy
    raw = json.dumps({
        "decision": "FAILED", "payout_bps": 9999, "reason_codes": [], "summary": "x",
    })
    j = contract._parse_and_validate_judgment(raw)
    assert j.payout_bps == 0


def test_insufficient_evidence_forces_10000_bps(direct_vm, deploy):
    contract = deploy
    raw = json.dumps({
        "decision": "INSUFFICIENT_EVIDENCE", "payout_bps": 0,
        "reason_codes": [], "summary": "x",
    })
    j = contract._parse_and_validate_judgment(raw)
    assert j.payout_bps == 10000


def test_partial_requires_strictly_between_0_and_10000(direct_vm, deploy):
    contract = deploy
    for bad in (0, 10000):
        raw = json.dumps({
            "decision": "PARTIAL", "payout_bps": bad, "reason_codes": [], "summary": "x",
        })
        with direct_vm.expect_revert():
            contract._parse_and_validate_judgment(raw)


def test_partial_keeps_llm_supplied_bps_when_valid(direct_vm, deploy):
    contract = deploy
    raw = json.dumps({
        "decision": "PARTIAL", "payout_bps": 7000, "reason_codes": ["PARTIAL_MATCH"], "summary": "x",
    })
    j = contract._parse_and_validate_judgment(raw)
    assert j.payout_bps == 7000


def test_missing_reason_codes_reverts(direct_vm, deploy):
    contract = deploy
    raw = json.dumps({"decision": "FULFILLED", "payout_bps": 10000, "summary": "x"})
    with direct_vm.expect_revert():
        contract._parse_and_validate_judgment(raw)


def test_summary_is_truncated(direct_vm, deploy):
    contract = deploy
    raw = json.dumps({
        "decision": "FULFILLED", "payout_bps": 10000,
        "reason_codes": [], "summary": "x" * 1000,
    })
    j = contract._parse_and_validate_judgment(raw)
    assert len(j.summary) == 500


# ---- _settle_from_judgment: decision -> settlement mapping --------------


@pytest.mark.parametrize(
    "decision,llm_bps,expected_provider_bps",
    [
        ("FULFILLED", 10000, 10000),
        ("FAILED", 0, 0),
        ("PARTIAL", 7000, 7000),
        ("INSUFFICIENT_EVIDENCE", 10000, 10000),
    ],
)
def test_settlement_mapping(
    direct_vm, deploy, buyer, provider, decision, llm_bps, expected_provider_bps
):
    contract = _judged_agreement(direct_vm, deploy, buyer, provider)
    agreement = contract.agreements["agr-1"]

    raw = json.dumps({
        "decision": decision, "payout_bps": llm_bps,
        "reason_codes": ["X"], "summary": "s",
    })
    judgment = contract._parse_and_validate_judgment(raw)
    assert judgment.payout_bps == expected_provider_bps

    contract._settle_from_judgment(agreement, judgment)

    assert agreement.escrow_deposited == 0
    assert agreement.status == "SETTLED"


def test_settlement_mapping_cannot_double_settle(direct_vm, deploy, buyer, provider):
    contract = _judged_agreement(direct_vm, deploy, buyer, provider)
    agreement = contract.agreements["agr-1"]

    judgment = contract._parse_and_validate_judgment(json.dumps({
        "decision": "FAILED", "payout_bps": 0, "reason_codes": [], "summary": "s",
    }))
    contract._settle_from_judgment(agreement, judgment)

    with direct_vm.expect_revert():
        contract._settle_from_judgment(agreement, judgment)


def test_failed_decision_updates_provider_disputes_lost(direct_vm, deploy, buyer, provider):
    contract = _judged_agreement(direct_vm, deploy, buyer, provider)
    agreement = contract.agreements["agr-1"]

    judgment = contract._parse_and_validate_judgment(json.dumps({
        "decision": "FAILED", "payout_bps": 0, "reason_codes": [], "summary": "s",
    }))
    contract._settle_from_judgment(agreement, judgment)

    rep = contract.get_reputation(provider)
    assert rep["disputes_opened"] == 1
    assert rep["disputes_lost"] == 1
    assert rep["disputes_won"] == 0


def test_fulfilled_decision_updates_provider_disputes_won_and_completed(
    direct_vm, deploy, buyer, provider
):
    contract = _judged_agreement(direct_vm, deploy, buyer, provider)
    agreement = contract.agreements["agr-1"]

    judgment = contract._parse_and_validate_judgment(json.dumps({
        "decision": "FULFILLED", "payout_bps": 10000, "reason_codes": [], "summary": "s",
    }))
    contract._settle_from_judgment(agreement, judgment)

    rep = contract.get_reputation(provider)
    assert rep["disputes_won"] == 1
    assert rep["completed"] == 1
    assert rep["disputes_lost"] == 0


def test_partial_decision_updates_provider_partials(direct_vm, deploy, buyer, provider):
    contract = _judged_agreement(direct_vm, deploy, buyer, provider)
    agreement = contract.agreements["agr-1"]

    judgment = contract._parse_and_validate_judgment(json.dumps({
        "decision": "PARTIAL", "payout_bps": 6000, "reason_codes": [], "summary": "s",
    }))
    contract._settle_from_judgment(agreement, judgment)

    rep = contract.get_reputation(provider)
    assert rep["partials"] == 1
    assert rep["disputes_won"] == 0
    assert rep["disputes_lost"] == 0
