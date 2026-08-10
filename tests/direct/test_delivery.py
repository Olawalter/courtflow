import pytest

from .conftest import AGREED_AMOUNT, BASE_TIME, create_and_accept, deliver, fund, iso_plus


def _funded(direct_vm, contract, buyer, provider):
    create_and_accept(direct_vm, contract, buyer, provider)
    fund(direct_vm, contract, buyer, "agr-1")


def test_submit_delivery_success(direct_vm, deploy, buyer, provider):
    contract = deploy
    _funded(direct_vm, contract, buyer, provider)

    deliver(direct_vm, contract, provider, "agr-1")

    agreement = contract.get_agreement("agr-1")
    assert agreement["status"] == "DELIVERED"

    delivery = contract.get_delivery("agr-1")
    assert delivery["status"] == "SUBMITTED"
    assert len(delivery["file_refs"]) == 2


def test_submit_delivery_only_provider(direct_vm, deploy, buyer, provider, stranger):
    contract = deploy
    _funded(direct_vm, contract, buyer, provider)

    direct_vm.sender = stranger
    with direct_vm.expect_revert():
        contract.submit_delivery("agr-1", "del-1", ["ipfs://x.png"], "meta")


def test_submit_delivery_requires_funded_state(direct_vm, deploy, buyer, provider):
    contract = deploy
    create_and_accept(direct_vm, contract, buyer, provider)  # not funded yet

    direct_vm.sender = provider
    with direct_vm.expect_revert():
        contract.submit_delivery("agr-1", "del-1", ["ipfs://x.png"], "meta")


def test_submit_delivery_requires_at_least_one_file(direct_vm, deploy, buyer, provider):
    contract = deploy
    _funded(direct_vm, contract, buyer, provider)

    direct_vm.sender = provider
    with direct_vm.expect_revert():
        contract.submit_delivery("agr-1", "del-1", [], "meta")


def test_submit_delivery_cannot_be_repeated(direct_vm, deploy, buyer, provider):
    contract = deploy
    _funded(direct_vm, contract, buyer, provider)
    deliver(direct_vm, contract, provider, "agr-1")

    direct_vm.sender = provider
    with direct_vm.expect_revert():
        contract.submit_delivery("agr-1", "del-2", ["ipfs://y.png"], "meta")


def test_late_delivery_is_flagged(direct_vm, deploy, buyer, provider):
    contract = deploy
    deadline = iso_plus(BASE_TIME, days=1)
    direct_vm.sender = buyer
    contract.create_agreement(
        "agr-1", provider, "terms", AGREED_AMOUNT, deadline, 86400
    )
    direct_vm.sender = provider
    contract.accept_agreement("agr-1")
    fund(direct_vm, contract, buyer, "agr-1")

    # warp past the deadline before delivering
    direct_vm.warp(iso_plus(BASE_TIME, days=2))
    deliver(direct_vm, contract, provider, "agr-1")

    agreement = contract.agreements["agr-1"]
    assert agreement.was_late is True


def test_on_time_delivery_is_not_flagged(direct_vm, deploy, buyer, provider):
    contract = deploy
    _funded(direct_vm, contract, buyer, provider)
    deliver(direct_vm, contract, provider, "agr-1")

    agreement = contract.agreements["agr-1"]
    assert agreement.was_late is False
