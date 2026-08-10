import pytest

from .conftest import AGREED_AMOUNT, BASE_TIME, TERMS, create_and_accept, iso_plus


def test_fund_agreement_exact_amount(direct_vm, deploy, buyer, provider):
    contract = deploy
    create_and_accept(direct_vm, contract, buyer, provider)

    direct_vm.sender = buyer
    direct_vm.value = AGREED_AMOUNT
    contract.fund_agreement("agr-1")
    direct_vm.value = 0

    got = contract.get_agreement("agr-1")
    assert got["status"] == "FUNDED"
    assert got["escrow_deposited"] == AGREED_AMOUNT
    assert got["agreed_amount"] == AGREED_AMOUNT


def test_fund_agreement_rejects_zero_value(direct_vm, deploy, buyer, provider):
    contract = deploy
    create_and_accept(direct_vm, contract, buyer, provider)

    direct_vm.sender = buyer
    direct_vm.value = 0
    with direct_vm.expect_revert():
        contract.fund_agreement("agr-1")


def test_fund_agreement_rejects_underpayment(direct_vm, deploy, buyer, provider):
    contract = deploy
    create_and_accept(direct_vm, contract, buyer, provider)

    direct_vm.sender = buyer
    direct_vm.value = AGREED_AMOUNT - 1
    with direct_vm.expect_revert():
        contract.fund_agreement("agr-1")
    direct_vm.value = 0


def test_fund_agreement_rejects_overpayment(direct_vm, deploy, buyer, provider):
    contract = deploy
    create_and_accept(direct_vm, contract, buyer, provider)

    direct_vm.sender = buyer
    direct_vm.value = AGREED_AMOUNT + 1
    with direct_vm.expect_revert():
        contract.fund_agreement("agr-1")  # "at least X" is explicitly disallowed
    direct_vm.value = 0


def test_fund_agreement_only_buyer(direct_vm, deploy, buyer, provider, stranger):
    contract = deploy
    create_and_accept(direct_vm, contract, buyer, provider)

    direct_vm.sender = stranger
    direct_vm.value = AGREED_AMOUNT
    with direct_vm.expect_revert():
        contract.fund_agreement("agr-1")
    direct_vm.value = 0


def test_fund_agreement_requires_active_state(direct_vm, deploy, buyer, provider):
    contract = deploy
    direct_vm.sender = buyer
    contract.create_agreement(
        "agr-1", provider, TERMS, AGREED_AMOUNT, iso_plus(BASE_TIME, days=7), 86400
    )
    # not yet accepted -> still DRAFT
    direct_vm.value = AGREED_AMOUNT
    with direct_vm.expect_revert():
        contract.fund_agreement("agr-1")
    direct_vm.value = 0


def test_fund_agreement_cannot_be_repeated(direct_vm, deploy, buyer, provider):
    contract = deploy
    create_and_accept(direct_vm, contract, buyer, provider)

    direct_vm.sender = buyer
    direct_vm.value = AGREED_AMOUNT
    contract.fund_agreement("agr-1")
    with direct_vm.expect_revert():
        contract.fund_agreement("agr-1")  # already FUNDED, not ACTIVE
    direct_vm.value = 0


def test_agreed_amount_and_escrow_deposited_are_independent_fields(direct_vm, deploy, buyer, provider):
    """The payout math must only ever read escrow_deposited, never agreed_amount."""
    contract = deploy
    create_and_accept(direct_vm, contract, buyer, provider)

    direct_vm.sender = buyer
    direct_vm.value = AGREED_AMOUNT
    contract.fund_agreement("agr-1")
    direct_vm.value = 0

    agreement = contract.agreements["agr-1"]
    assert agreement.agreed_amount == AGREED_AMOUNT
    assert agreement.escrow_deposited == AGREED_AMOUNT

    # simulate settlement having happened: escrow zeroed, agreed_amount untouched
    agreement.escrow_deposited = 0
    assert agreement.agreed_amount == AGREED_AMOUNT
