import json

import pytest

from .conftest import create_and_accept, deliver, fund


def test_reputation_defaults_to_zero_for_unknown_address(direct_vm, deploy, provider):
    contract = deploy
    rep = contract.get_reputation(provider)
    assert rep == {
        "completed": 0,
        "disputes_opened": 0,
        "disputes_won": 0,
        "disputes_lost": 0,
        "partials": 0,
        "late_deliveries": 0,
        "revision_requests": 0,
    }


def test_opening_a_dispute_alone_does_not_change_reputation(direct_vm, deploy, buyer, provider):
    """Reputation must not be touched just because a dispute was opened -- only
    a finalized settlement may update it."""
    contract = deploy
    create_and_accept(direct_vm, contract, buyer, provider)
    fund(direct_vm, contract, buyer, "agr-1")
    deliver(direct_vm, contract, provider, "agr-1")

    direct_vm.sender = buyer
    contract.open_dispute("agr-1", "disp-1", "claim")

    rep = contract.get_reputation(provider)
    assert rep["disputes_opened"] == 0
    assert rep["disputes_lost"] == 0
    assert rep["disputes_won"] == 0


def test_responding_to_a_dispute_does_not_change_reputation(direct_vm, deploy, buyer, provider):
    contract = deploy
    create_and_accept(direct_vm, contract, buyer, provider)
    fund(direct_vm, contract, buyer, "agr-1")
    deliver(direct_vm, contract, provider, "agr-1")

    direct_vm.sender = buyer
    contract.open_dispute("agr-1", "disp-1", "claim")
    direct_vm.sender = provider
    contract.respond_to_dispute("disp-1", "response")

    rep = contract.get_reputation(provider)
    assert rep["disputes_opened"] == 0


def test_reputation_updates_exactly_once_per_finalized_settlement(direct_vm, deploy, buyer, provider):
    contract = deploy
    create_and_accept(direct_vm, contract, buyer, provider)
    fund(direct_vm, contract, buyer, "agr-1")
    deliver(direct_vm, contract, provider, "agr-1")

    direct_vm.sender = buyer
    contract.approve_delivery("agr-1")

    rep = contract.get_reputation(provider)
    assert rep["completed"] == 1

    # a second attempt to settle the same agreement must fail, so reputation
    # cannot be incremented twice for one delivery
    with direct_vm.expect_revert():
        contract.approve_delivery("agr-1")

    rep_after = contract.get_reputation(provider)
    assert rep_after["completed"] == 1
