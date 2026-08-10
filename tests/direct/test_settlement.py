import pytest

from .conftest import (
    AGREED_AMOUNT,
    BASE_TIME,
    DISPUTE_WINDOW_SECONDS,
    create_and_accept,
    deliver,
    fund,
    iso_plus,
)


def _delivered(direct_vm, contract, buyer, provider):
    create_and_accept(direct_vm, contract, buyer, provider)
    fund(direct_vm, contract, buyer, "agr-1")
    deliver(direct_vm, contract, provider, "agr-1")


def test_approve_delivery_settles_full_amount_to_provider(direct_vm, deploy, buyer, provider):
    contract = deploy
    _delivered(direct_vm, contract, buyer, provider)

    direct_vm.sender = buyer
    contract.approve_delivery("agr-1")

    agreement = contract.get_agreement("agr-1")
    assert agreement["status"] == "SETTLED"
    assert agreement["escrow_deposited"] == 0

    rep = contract.get_reputation(provider)
    assert rep["completed"] == 1


def test_approve_delivery_only_buyer(direct_vm, deploy, buyer, provider, stranger):
    contract = deploy
    _delivered(direct_vm, contract, buyer, provider)

    direct_vm.sender = stranger
    with direct_vm.expect_revert():
        contract.approve_delivery("agr-1")


def test_approve_delivery_cannot_double_settle(direct_vm, deploy, buyer, provider):
    """settle() then settle() again must not release the same funds twice."""
    contract = deploy
    _delivered(direct_vm, contract, buyer, provider)

    direct_vm.sender = buyer
    contract.approve_delivery("agr-1")

    with direct_vm.expect_revert():
        contract.approve_delivery("agr-1")  # no longer DELIVERED, and escrow is already 0


def test_approve_delivery_late_flag_updates_reputation(direct_vm, deploy, buyer, provider):
    contract = deploy
    deadline = iso_plus(BASE_TIME, days=1)
    direct_vm.sender = buyer
    contract.create_agreement("agr-1", provider, "terms", AGREED_AMOUNT, deadline, 86400)
    direct_vm.sender = provider
    contract.accept_agreement("agr-1")
    fund(direct_vm, contract, buyer, "agr-1")

    direct_vm.warp(iso_plus(BASE_TIME, days=2))
    deliver(direct_vm, contract, provider, "agr-1")

    direct_vm.sender = buyer
    contract.approve_delivery("agr-1")

    rep = contract.get_reputation(provider)
    assert rep["completed"] == 1
    assert rep["late_deliveries"] == 1


def test_claim_timeout_refunds_buyer(direct_vm, deploy, buyer, provider):
    contract = deploy
    deadline = iso_plus(BASE_TIME, days=1)
    direct_vm.sender = buyer
    contract.create_agreement("agr-1", provider, "terms", AGREED_AMOUNT, deadline, 86400)
    direct_vm.sender = provider
    contract.accept_agreement("agr-1")
    fund(direct_vm, contract, buyer, "agr-1")
    # provider never delivers

    direct_vm.warp(iso_plus(BASE_TIME, days=2))
    direct_vm.sender = buyer
    contract.claim_timeout("agr-1")

    agreement = contract.get_agreement("agr-1")
    assert agreement["status"] == "TIMED_OUT"
    assert agreement["escrow_deposited"] == 0


def test_claim_timeout_before_deadline_reverts(direct_vm, deploy, buyer, provider):
    contract = deploy
    create_and_accept(direct_vm, contract, buyer, provider)
    fund(direct_vm, contract, buyer, "agr-1")

    direct_vm.sender = buyer
    with direct_vm.expect_revert():
        contract.claim_timeout("agr-1")


def test_claim_timeout_only_buyer(direct_vm, deploy, buyer, provider, stranger):
    contract = deploy
    deadline = iso_plus(BASE_TIME, days=1)
    direct_vm.sender = buyer
    contract.create_agreement("agr-1", provider, "terms", AGREED_AMOUNT, deadline, 86400)
    direct_vm.sender = provider
    contract.accept_agreement("agr-1")
    fund(direct_vm, contract, buyer, "agr-1")

    direct_vm.warp(iso_plus(BASE_TIME, days=2))
    direct_vm.sender = stranger
    with direct_vm.expect_revert():
        contract.claim_timeout("agr-1")


def test_claim_timeout_cannot_double_settle(direct_vm, deploy, buyer, provider):
    contract = deploy
    deadline = iso_plus(BASE_TIME, days=1)
    direct_vm.sender = buyer
    contract.create_agreement("agr-1", provider, "terms", AGREED_AMOUNT, deadline, 86400)
    direct_vm.sender = provider
    contract.accept_agreement("agr-1")
    fund(direct_vm, contract, buyer, "agr-1")

    direct_vm.warp(iso_plus(BASE_TIME, days=2))
    direct_vm.sender = buyer
    contract.claim_timeout("agr-1")

    with direct_vm.expect_revert():
        contract.claim_timeout("agr-1")  # no longer FUNDED


def test_settle_rejects_mismatched_split(direct_vm, deploy, buyer, provider):
    """Internal invariant: provider_amount + buyer_amount must equal escrow_deposited."""
    contract = deploy
    _delivered(direct_vm, contract, buyer, provider)

    agreement = contract.agreements["agr-1"]
    with direct_vm.expect_revert():
        contract._settle(agreement, agreement.escrow_deposited, 1)  # off by one


def test_settle_rejects_when_already_zero(direct_vm, deploy, buyer, provider):
    contract = deploy
    _delivered(direct_vm, contract, buyer, provider)

    agreement = contract.agreements["agr-1"]
    agreement.escrow_deposited = 0
    with direct_vm.expect_revert():
        contract._settle(agreement, 0, 0)


# ---- claim_delivery_timeout: recovery when the buyer goes silent post-delivery ----


def test_claim_delivery_timeout_pays_provider_after_window_closes(direct_vm, deploy, buyer, provider):
    contract = deploy
    _delivered(direct_vm, contract, buyer, provider)  # buyer never approves or disputes

    direct_vm.warp(iso_plus(BASE_TIME, seconds=DISPUTE_WINDOW_SECONDS + 1))
    direct_vm.sender = provider
    contract.claim_delivery_timeout("agr-1")

    agreement = contract.get_agreement("agr-1")
    assert agreement["status"] == "TIMED_OUT"
    assert agreement["escrow_deposited"] == 0

    rep = contract.get_reputation(provider)
    assert rep["completed"] == 1


def test_claim_delivery_timeout_before_window_closes_reverts(direct_vm, deploy, buyer, provider):
    contract = deploy
    _delivered(direct_vm, contract, buyer, provider)

    direct_vm.sender = provider
    with direct_vm.expect_revert():
        contract.claim_delivery_timeout("agr-1")


def test_claim_delivery_timeout_only_provider(direct_vm, deploy, buyer, provider, stranger):
    contract = deploy
    _delivered(direct_vm, contract, buyer, provider)

    direct_vm.warp(iso_plus(BASE_TIME, seconds=DISPUTE_WINDOW_SECONDS + 1))
    direct_vm.sender = stranger
    with direct_vm.expect_revert():
        contract.claim_delivery_timeout("agr-1")

    direct_vm.sender = buyer
    with direct_vm.expect_revert():
        contract.claim_delivery_timeout("agr-1")


def test_claim_delivery_timeout_requires_delivered_state(direct_vm, deploy, buyer, provider):
    contract = deploy
    create_and_accept(direct_vm, contract, buyer, provider)
    fund(direct_vm, contract, buyer, "agr-1")  # not delivered yet

    direct_vm.warp(iso_plus(BASE_TIME, seconds=DISPUTE_WINDOW_SECONDS + 1))
    direct_vm.sender = provider
    with direct_vm.expect_revert():
        contract.claim_delivery_timeout("agr-1")


def test_claim_delivery_timeout_cannot_double_settle(direct_vm, deploy, buyer, provider):
    contract = deploy
    _delivered(direct_vm, contract, buyer, provider)

    direct_vm.warp(iso_plus(BASE_TIME, seconds=DISPUTE_WINDOW_SECONDS + 1))
    direct_vm.sender = provider
    contract.claim_delivery_timeout("agr-1")

    with direct_vm.expect_revert():
        contract.claim_delivery_timeout("agr-1")  # no longer DELIVERED


def test_open_dispute_blocks_delivery_timeout(direct_vm, deploy, buyer, provider):
    """Once the buyer disputes within the window, the provider's timeout path
    must no longer be available -- the dispute takes over as the resolution path."""
    contract = deploy
    _delivered(direct_vm, contract, buyer, provider)

    direct_vm.sender = buyer
    contract.open_dispute("agr-1", "disp-1", "claim")

    direct_vm.warp(iso_plus(BASE_TIME, seconds=DISPUTE_WINDOW_SECONDS + 1))
    direct_vm.sender = provider
    with direct_vm.expect_revert():
        contract.claim_delivery_timeout("agr-1")
