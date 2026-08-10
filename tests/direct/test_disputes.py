import pytest

from .conftest import BASE_TIME, create_and_accept, deliver, fund, iso_plus


def _delivered(direct_vm, contract, buyer, provider):
    create_and_accept(direct_vm, contract, buyer, provider)
    fund(direct_vm, contract, buyer, "agr-1")
    deliver(direct_vm, contract, provider, "agr-1")


def test_open_dispute_success(direct_vm, deploy, buyer, provider):
    contract = deploy
    _delivered(direct_vm, contract, buyer, provider)

    direct_vm.sender = buyer
    contract.open_dispute("agr-1", "disp-1", "The logo contains copyrighted material.")

    assert contract.get_agreement("agr-1")["status"] == "DISPUTED"
    dispute = contract.get_dispute("disp-1")
    assert dispute["status"] == "OPEN"
    assert dispute["claim"] == "The logo contains copyrighted material."


def test_open_dispute_only_buyer(direct_vm, deploy, buyer, provider, stranger):
    contract = deploy
    _delivered(direct_vm, contract, buyer, provider)

    direct_vm.sender = stranger
    with direct_vm.expect_revert():
        contract.open_dispute("agr-1", "disp-1", "claim")


def test_open_dispute_requires_delivered_state(direct_vm, deploy, buyer, provider):
    contract = deploy
    create_and_accept(direct_vm, contract, buyer, provider)
    fund(direct_vm, contract, buyer, "agr-1")  # not delivered yet

    direct_vm.sender = buyer
    with direct_vm.expect_revert():
        contract.open_dispute("agr-1", "disp-1", "claim")


def test_open_dispute_rejects_empty_claim(direct_vm, deploy, buyer, provider):
    contract = deploy
    _delivered(direct_vm, contract, buyer, provider)

    direct_vm.sender = buyer
    with direct_vm.expect_revert():
        contract.open_dispute("agr-1", "disp-1", "   ")


def test_open_dispute_after_window_closes(direct_vm, deploy, buyer, provider):
    contract = deploy
    _delivered(direct_vm, contract, buyer, provider)

    direct_vm.warp(iso_plus(BASE_TIME, hours=25))  # window is 24h
    direct_vm.sender = buyer
    with direct_vm.expect_revert():
        contract.open_dispute("agr-1", "disp-1", "claim")


def test_respond_to_dispute_success(direct_vm, deploy, buyer, provider):
    contract = deploy
    _delivered(direct_vm, contract, buyer, provider)
    direct_vm.sender = buyer
    contract.open_dispute("agr-1", "disp-1", "claim")

    direct_vm.sender = provider
    contract.respond_to_dispute("disp-1", "The logo is fully original artwork.")

    assert contract.get_agreement("agr-1")["status"] == "UNDER_REVIEW"
    dispute = contract.get_dispute("disp-1")
    assert dispute["status"] == "UNDER_REVIEW"
    assert dispute["provider_response"] == "The logo is fully original artwork."


def test_respond_to_dispute_only_provider(direct_vm, deploy, buyer, provider, stranger):
    contract = deploy
    _delivered(direct_vm, contract, buyer, provider)
    direct_vm.sender = buyer
    contract.open_dispute("agr-1", "disp-1", "claim")

    direct_vm.sender = stranger
    with direct_vm.expect_revert():
        contract.respond_to_dispute("disp-1", "response")


def test_respond_to_dispute_cannot_repeat(direct_vm, deploy, buyer, provider):
    contract = deploy
    _delivered(direct_vm, contract, buyer, provider)
    direct_vm.sender = buyer
    contract.open_dispute("agr-1", "disp-1", "claim")
    direct_vm.sender = provider
    contract.respond_to_dispute("disp-1", "response")

    with direct_vm.expect_revert():
        contract.respond_to_dispute("disp-1", "response again")
