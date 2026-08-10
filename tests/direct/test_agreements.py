import pytest

from .conftest import (
    AGREED_AMOUNT,
    BASE_TIME,
    DISPUTE_WINDOW_SECONDS,
    TERMS,
    as_hex,
    create_and_accept,
    iso_plus,
)


def test_create_agreement_success(direct_vm, deploy, buyer, provider):
    contract = deploy
    direct_vm.sender = buyer
    deadline = iso_plus(BASE_TIME, days=7)
    contract.create_agreement(
        "agr-1", provider, TERMS, AGREED_AMOUNT, deadline, DISPUTE_WINDOW_SECONDS
    )

    got = contract.get_agreement("agr-1")
    assert got["status"] == "DRAFT"
    assert got["agreed_amount"] == AGREED_AMOUNT
    assert got["escrow_deposited"] == 0
    assert got["buyer"].lower() == as_hex(buyer).lower()
    assert got["provider"].lower() == as_hex(provider).lower()


def test_create_agreement_rejects_duplicate_id(direct_vm, deploy, buyer, provider):
    contract = deploy
    direct_vm.sender = buyer
    deadline = iso_plus(BASE_TIME, days=7)
    contract.create_agreement("agr-1", provider, TERMS, AGREED_AMOUNT, deadline, DISPUTE_WINDOW_SECONDS)

    with direct_vm.expect_revert():
        contract.create_agreement("agr-1", provider, TERMS, AGREED_AMOUNT, deadline, DISPUTE_WINDOW_SECONDS)


def test_create_agreement_rejects_zero_amount(direct_vm, deploy, buyer, provider):
    contract = deploy
    direct_vm.sender = buyer
    deadline = iso_plus(BASE_TIME, days=7)
    with direct_vm.expect_revert():
        contract.create_agreement("agr-1", provider, TERMS, 0, deadline, DISPUTE_WINDOW_SECONDS)


def test_create_agreement_rejects_past_deadline(direct_vm, deploy, buyer, provider):
    contract = deploy
    direct_vm.sender = buyer
    past = iso_plus(BASE_TIME, days=-1)
    with direct_vm.expect_revert():
        contract.create_agreement("agr-1", provider, TERMS, AGREED_AMOUNT, past, DISPUTE_WINDOW_SECONDS)


def test_create_agreement_rejects_self_deal(direct_vm, deploy, buyer):
    contract = deploy
    direct_vm.sender = buyer
    deadline = iso_plus(BASE_TIME, days=7)
    with direct_vm.expect_revert():
        contract.create_agreement("agr-1", buyer, TERMS, AGREED_AMOUNT, deadline, DISPUTE_WINDOW_SECONDS)


def test_accept_agreement_only_provider(direct_vm, deploy, buyer, provider, stranger):
    contract = deploy
    direct_vm.sender = buyer
    contract.create_agreement(
        "agr-1", provider, TERMS, AGREED_AMOUNT, iso_plus(BASE_TIME, days=7), DISPUTE_WINDOW_SECONDS
    )

    direct_vm.sender = stranger
    with direct_vm.expect_revert():
        contract.accept_agreement("agr-1")

    direct_vm.sender = provider
    contract.accept_agreement("agr-1")
    assert contract.get_agreement("agr-1")["status"] == "ACTIVE"


def test_accept_agreement_illegal_transition(direct_vm, deploy, buyer, provider):
    contract = deploy
    create_and_accept(direct_vm, contract, buyer, provider)

    direct_vm.sender = provider
    with direct_vm.expect_revert():
        contract.accept_agreement("agr-1")  # already ACTIVE, not DRAFT


def test_cancel_agreement_only_buyer_before_acceptance(direct_vm, deploy, buyer, provider, stranger):
    contract = deploy
    direct_vm.sender = buyer
    contract.create_agreement(
        "agr-1", provider, TERMS, AGREED_AMOUNT, iso_plus(BASE_TIME, days=7), DISPUTE_WINDOW_SECONDS
    )

    direct_vm.sender = stranger
    with direct_vm.expect_revert():
        contract.cancel_agreement("agr-1")

    direct_vm.sender = buyer
    contract.cancel_agreement("agr-1")
    assert contract.get_agreement("agr-1")["status"] == "CANCELLED"


def test_cancel_agreement_illegal_after_acceptance(direct_vm, deploy, buyer, provider):
    contract = deploy
    create_and_accept(direct_vm, contract, buyer, provider)

    direct_vm.sender = buyer
    with direct_vm.expect_revert():
        contract.cancel_agreement("agr-1")  # ACTIVE → CANCELLED is illegal (spec: only before acceptance)


def test_get_unknown_agreement_reverts(direct_vm, deploy):
    contract = deploy
    with direct_vm.expect_revert():
        contract.get_agreement("does-not-exist")
