import datetime

import pytest

CONTRACT_PATH = "contracts/courtflow.py"


def as_hex(addr) -> str:
    """direct_alice/direct_owner resolve to raw bytes in this harness while
    direct_bob/direct_charlie resolve to real Address objects. Both encode the
    same 20 address bytes, just via different Python types and (for the
    bytes-based fixtures) without EIP-55 checksum casing -- normalize to
    lowercase hex for comparison against contract-returned addresses, which
    are always checksummed since they come from a real Address internally."""
    raw = addr.as_bytes if hasattr(addr, "as_bytes") else addr
    return "0x" + raw.hex()

TERMS = (
    "Create an original company logo. Requirements: 1) Original artwork. "
    "2) No copyrighted material. 3) Follow supplied brand guidelines. "
    "4) PNG delivery. 5) SVG delivery. 6) Editable/source file. "
    "7) Delivery before the agreed deadline. Payment: 500 GEN. "
    "Dispute window: 24 hours after delivery."
)
AGREED_AMOUNT = 500
DISPUTE_WINDOW_SECONDS = 24 * 60 * 60

BASE_TIME = "2026-01-01T00:00:00+00:00"


def iso_plus(base: str, **delta) -> str:
    dt = datetime.datetime.fromisoformat(base)
    return (dt + datetime.timedelta(**delta)).isoformat()


@pytest.fixture
def buyer(direct_alice):
    return direct_alice


@pytest.fixture
def provider(direct_bob):
    return direct_bob


@pytest.fixture
def stranger(direct_charlie):
    return direct_charlie


SDK_VERSION = "v0.3.0-rc7"


@pytest.fixture
def deploy(direct_deploy, direct_vm, buyer):
    direct_vm.warp(BASE_TIME)
    direct_vm.sender = buyer
    return direct_deploy(CONTRACT_PATH, sdk_version=SDK_VERSION)


def create_and_accept(direct_vm, contract, buyer, provider, agreement_id="agr-1", deadline=None):
    if deadline is None:
        deadline = iso_plus(BASE_TIME, days=7)
    direct_vm.sender = buyer
    # provider is Address-typed in the contract; the calldata roundtrip does
    # NOT auto-convert address-shaped strings (confirmed both here and live
    # on StudioNet) -- pass the real Address object, not .as_hex.
    contract.create_agreement(
        agreement_id, provider, TERMS, AGREED_AMOUNT, deadline, DISPUTE_WINDOW_SECONDS
    )
    direct_vm.sender = provider
    contract.accept_agreement(agreement_id)
    return agreement_id


def fund(direct_vm, contract, buyer, agreement_id, amount=AGREED_AMOUNT):
    direct_vm.sender = buyer
    direct_vm.value = amount
    contract.fund_agreement(agreement_id)
    direct_vm.value = 0


def deliver(direct_vm, contract, provider, agreement_id, delivery_id="del-1", refs=None):
    direct_vm.sender = provider
    contract.submit_delivery(
        agreement_id, delivery_id, refs or ["ipfs://logo.png", "ipfs://logo.svg"], "final delivery"
    )
