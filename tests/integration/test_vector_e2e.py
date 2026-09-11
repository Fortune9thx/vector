"""
Integration tests against a real GenLayer node (Studio or Bradbury testnet).

These are the only tests in this repo that exercise gl.deploy_contract (the
VectorFactory -> VectorBounty on-chain factory pattern) and a real live web
fetch + real LLM consensus round, since gltest's direct-mode WASI mock has no
default support for cross-contract deploy (see
tests/direct/test_factory_validation.py's module docstring) and direct-mode
mocks stand in for gl.nondet.web.render/exec_prompt rather than exercising
them for real.

Two real API-shape corrections vs. a naive first draft, confirmed by reading
gltest's own installed source (genlayer_py/transactions/actions.py,
gltest/contracts/contract_factory.py, contract.py, contract_functions.py)
rather than assumed from a prior project's test file:

1. `get_contract_factory` is a plain importable function (`from gltest import
   get_contract_factory`), NOT a pytest fixture -- passing it as a test
   parameter fails with "fixture 'get_contract_factory' not found". `accounts`
   and `default_account`, by contrast, ARE real fixtures (registered via
   `pytest_plugins = ["gltest.fixtures"]"), safe to take as test parameters.
2. **A write's `.transact()` call never raises a Python exception on a live
   network revert.** `wait_for_transaction_receipt` (genlayer_py's live
   client path) only raises on a timeout or a missing transaction -- a
   `gl.vm.UserError` revert comes back as an ordinary ACCEPTED receipt with
   `tx_execution_result_name: "FINISHED_WITH_ERROR"`. This is a DIFFERENT
   code path from gltest's direct-mode WASI mock (which genuinely raises a
   Python exception synchronously, since it executes contract code
   in-process) -- direct-mode's `pytest.raises(Exception, match=...)` pattern
   does not carry over to a live integration test. `gltest.assertions`'
   `tx_execution_failed()`/`tx_execution_succeeded()` helpers also check a
   receipt shape Bradbury's real RPC doesn't populate (a separately confirmed
   SDK gap), so this file checks `tx_execution_result_name` directly instead.
   Every revert assertion below uses the `_reverted()` helper for this reason
   -- never `pytest.raises` around a `.transact()` call.

A write method's own Python-level return value (e.g. create_bounty's
returned bounty address, submit_disclosure's returned disclosure_id) is also
not exposed anywhere in a live transaction receipt in a documented, decoded
form -- `_new_bounty_address()` below resolves it the same reliable way the
frontend does (see frontend/lib/vector-calls.ts's waitForNewBounty):
diffing the append-only registry list before and after.

Scope note on finalize_payout()/claim_payout(): a disclosure only becomes
eligible for finalize_payout() once its real 48-hour challenge window has
elapsed (measured against the chain's own consensus timestamp -- there is no
way to warp time on a live testnet). Waiting out 48 real hours is not
practical for an automated test run, so the full post-window
finalize_payout -> claim_payout mechanics (including the underfunded-pool
and double-claim guards) are exhaustively covered in
tests/direct/test_expire_and_payout.py using vm.warp()/warp_now(), which can
move the contract's notion of "now" instantly. What this file proves instead
-- the part that direct-mode categorically cannot -- is the full live
create -> submit -> triage cycle end to end: a real gl.deploy_contract spawn,
a real gl.nondet.web.render fetch of a real page, and a real
gl.nondet.exec_prompt verdict reaching genuine validator consensus, for both
the REJECTED and VERIFIED outcomes (bond forfeiture and bond refund
respectively -- both real, immediate transfers, both reachable without
waiting on the challenge window).

Requires a configured gltest.config.yaml pointing at a live node and funded
test accounts. Run with: gltest tests/integration -v
"""

from pathlib import Path

import pytest

from gltest import get_contract_factory

CONTRACTS_DIR = Path(__file__).resolve().parents[2] / "contracts"
VECTOR_BOUNTY_PATH = CONTRACTS_DIR / "VectorBounty.py"
VECTOR_FACTORY_PATH = CONTRACTS_DIR / "VectorFactory.py"

# Wikipedia's REST summary API, not the human-facing HTML page -- confirmed
# in this account's Helm project (2026-09-06) to be immune to the
# User-Agent-based bot detection that makes the HTML page genuinely flaky
# for automated fetches. Heartbleed is a real, historical, publicly
# documented, permanently-stable vulnerability, so a disclosure describing
# its actual mechanism is a precise, checkable verdict (is_real, high
# severity) rather than a vague "any plausible verdict" assertion.
TARGET_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/Heartbleed"

# The one real signal a live-network write's receipt gives for "this
# reverted" -- see module docstring. Never rely on pytest.raises around a
# .transact() call against a live node.
REVERTED_RESULT = "FINISHED_WITH_ERROR"

pytestmark = pytest.mark.integration


def _reverted(receipt: dict) -> bool:
    return receipt.get("tx_execution_result_name") == REVERTED_RESULT


@pytest.fixture(scope="module")
def factory(accounts):
    """Deploy a fresh VectorFactory with the real VectorBounty.py source
    embedded, exactly as deploy/001_deploy_vector_factory.ts does for a real
    network deployment."""
    bounty_code = VECTOR_BOUNTY_PATH.read_text(encoding="utf-8")
    contract_factory = get_contract_factory(contract_file_path=str(VECTOR_FACTORY_PATH))
    return contract_factory.deploy(args=[bounty_code, 1], account=accounts[0])


def _new_bounty_address(factory, before_addresses: list) -> str:
    """bounties is an append-only registry -- the new bounty is whatever
    appears past the pre-call length, exactly like the frontend's
    waitForNewBounty. No retry loop needed here since this file only reads
    back from the SAME node that just processed the write, synchronously."""
    after = factory.get_bounties().call()
    assert len(after) > len(before_addresses)
    return after[len(before_addresses)]


def _create_bounty(factory, sponsor, **overrides):
    args = dict(
        title="Heartbleed disclosure integration probe",
        description="Live probe bounty for the automated integration suite.",
        target_url=TARGET_URL,
        severity_critical_wei="1000",
        severity_high_wei="500",
        severity_medium_wei="200",
        severity_low_wei="50",
        disclosure_bond_wei="10",
    )
    args.update(overrides)
    before = factory.get_bounties().call()
    receipt = (
        factory.connect(sponsor)
        .create_bounty(
            args=[
                args["title"],
                args["description"],
                args["target_url"],
                args["severity_critical_wei"],
                args["severity_high_wei"],
                args["severity_medium_wei"],
                args["severity_low_wei"],
                args["disclosure_bond_wei"],
            ]
        )
        .transact(value=1)
    )
    assert not _reverted(receipt), f"create_bounty reverted: {receipt}"

    address_hex = _new_bounty_address(factory, before)
    bounty = get_contract_factory(contract_file_path=str(VECTOR_BOUNTY_PATH)).build_contract(
        contract_address=address_hex
    )
    return address_hex, bounty


def test_create_bounty_spawns_readable_child_contract(factory, accounts):
    sponsor = accounts[0]
    address_hex, bounty = _create_bounty(factory, sponsor)
    assert address_hex.startswith("0x")

    bounties = factory.get_bounties().call()
    assert address_hex in bounties

    meta = factory.get_bounty_meta(args=[address_hex]).call()
    assert meta["title"] == "Heartbleed disclosure integration probe"

    info = bounty.get_bounty_info().call()
    assert info["status"] == "open"
    assert info["sponsor"].lower() == sponsor.address.lower()


def test_factory_owner_is_informational_except_for_withdraw_fees(factory, accounts):
    """get_owner() gates exactly one thing (withdraw_fees) -- every other
    write (create_bounty) is intentionally permissionless, gated by the
    creation stake, not an allowlist."""
    deployer = accounts[0]
    assert factory.get_owner().call().lower() == deployer.address.lower()


def test_withdraw_fees_only_owner_and_recovers_real_collected_stake(factory, accounts):
    owner = accounts[0]
    outsider = accounts[1]
    before = int(factory.get_collected_fees().call())

    _create_bounty(factory, owner)
    after_create = int(factory.get_collected_fees().call())
    assert after_create == before + 1  # 1 wei creation stake from the fixture

    denied_receipt = factory.connect(outsider).withdraw_fees(args=[]).transact()
    assert _reverted(denied_receipt), "withdraw_fees should revert for a non-owner caller"
    assert int(factory.get_collected_fees().call()) == after_create  # unchanged

    ok_receipt = factory.connect(owner).withdraw_fees(args=[]).transact()
    assert not _reverted(ok_receipt), f"withdraw_fees reverted for the real owner: {ok_receipt}"
    assert int(factory.get_collected_fees().call()) == 0


def test_fund_and_reject_disclosure_end_to_end(factory, accounts):
    """A disclosure describing something the live target does NOT actually
    say must be rejected by real validator consensus, with its bond
    genuinely forfeited into the pool -- a real transfer, not a mocked one."""
    sponsor = accounts[0]
    researcher = accounts[1]
    _, bounty = _create_bounty(factory, sponsor)

    fund_receipt = bounty.connect(sponsor).fund_pool(args=[]).transact(value=5000)
    assert not _reverted(fund_receipt), f"fund_pool reverted: {fund_receipt}"

    submit_receipt = (
        bounty.connect(researcher)
        .submit_disclosure(
            args=[
                "Hardcoded AWS credentials",
                "The page allegedly contains a hardcoded AWS secret access key in plaintext.",
                "1. Fetch the page. 2. Search for 'AKIA'. 3. Find none, because this claim is false.",
                "aws_secret_key constant",
                "critical",
            ]
        )
        .transact(value=10)
    )
    assert not _reverted(submit_receipt), f"submit_disclosure reverted: {submit_receipt}"

    disclosures_before = bounty.get_disclosures().call()
    disclosure_id = disclosures_before[-1]

    triage_receipt = bounty.connect(researcher).triage(args=[disclosure_id]).transact()
    assert not _reverted(triage_receipt), f"triage reverted: {triage_receipt}"

    record = bounty.get_disclosure(args=[disclosure_id]).call()
    assert record["status"] == "REJECTED"
    assert record["assigned_severity"] == ""

    info = bounty.get_bounty_info().call()
    assert int(info["pool_remaining"]) == 5010  # 5000 funded + 10 forfeited bond


def test_submit_and_verify_disclosure_end_to_end(factory, accounts):
    """End-to-end: spawn a VectorBounty via the factory, submit a disclosure
    describing a real, stable, well-documented historical vulnerability
    against a live page that actually confirms it, and let a real
    Equivalence Principle consensus round verify it -- confirming bond
    refund and payout_wei assignment against genuine on-chain state."""
    sponsor = accounts[0]
    researcher = accounts[2]
    _, bounty = _create_bounty(factory, sponsor)

    submit_receipt = (
        bounty.connect(researcher)
        .submit_disclosure(
            args=[
                "OpenSSL Heartbeat out-of-bounds memory read",
                (
                    "The OpenSSL heartbeat extension implementation does not properly "
                    "validate the length of the heartbeat request against the actual "
                    "payload, allowing an attacker to read up to 64KB of adjacent "
                    "process memory (potentially including private keys and session "
                    "data) per request, with no authentication required."
                ),
                "1. Send a malformed heartbeat request with an oversized length field. "
                "2. Observe adjacent heap memory returned in the response.",
                "OpenSSL heartbeat extension (TLS/DTLS heartbeat handling)",
                "high",
            ]
        )
        .transact(value=10)
    )
    assert not _reverted(submit_receipt), f"submit_disclosure reverted: {submit_receipt}"

    disclosure_id = bounty.get_disclosures().call()[-1]

    triage_receipt = bounty.connect(researcher).triage(args=[disclosure_id]).transact()
    assert not _reverted(triage_receipt), f"triage reverted: {triage_receipt}"

    record = bounty.get_disclosure(args=[disclosure_id]).call()
    assert record["status"] == "VERIFIED"
    assert record["assigned_severity"] in ("critical", "high")  # model's own real-world severity call
    assert int(record["payout_wei"]) > 0
    assert int(record["challenge_window_ends_at"]) > 0
    assert record["evidence_snapshot"]  # real fetched content, non-empty

    assert disclosure_id in bounty.get_disclosures().call()
