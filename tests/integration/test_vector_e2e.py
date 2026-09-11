"""
Integration tests against a real GenLayer node (Studio Devnet).

These are the only tests in this repo that exercise a real deploy-then-
register bounty creation, a real live web fetch, and real LLM consensus,
since gltest's direct-mode WASI mock has no default handler for
cross-contract calls (see tests/direct/test_factory_validation.py's module
docstring) and direct-mode mocks stand in for gl.nondet.web.render/
exec_prompt rather than exercising them for real.

Architecture note: bounty creation is deploy-then-register, not
factory-deploys-child. A Consensus v0.6 platform gap means any write that
itself triggers an internal gl.contract.deploy() cannot currently complete
(confirmed live: "fee no_matching_allocation # internal" from the generic
fee estimate, and a bare server-side "execution failed" from both
estimateTransactionFeesForWrite and a raw sim_call -- three independent
paths across two SDKs, not a client bug). _create_bounty() below does what
the frontend does: deploy VectorBounty as an ordinary top-level transaction
(sponsor as the direct signer), then call register_bounty() on the factory,
which cross-contract-reads the deployed child's own get_bounty_info() to
populate the registry -- never trusting caller-supplied metadata.

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
deploy -> register -> submit -> triage cycle end to end: a real top-level
VectorBounty deploy, a real register_bounty() cross-contract read, a real
gl.nondet.web.render fetch of a real page, and a real gl.nondet.exec_prompt
verdict reaching genuine validator consensus, for both the REJECTED and
VERIFIED outcomes (bond forfeiture and bond refund respectively -- both
real, immediate transfers, both reachable without waiting on the challenge
window).

Requires a configured gltest.config.yaml pointing at a live node and funded
test accounts. Run with: gltest tests/integration --network studio_devnet -v
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

# gltest's Python client (genlayer_py) does not auto-estimate Consensus
# v0.6 fees the way genlayer-js's client does -- every deploy/transact call
# below needs an explicit fee_value or it reverts with
# "FeesDistributionMissing" before the contract even runs. A flat,
# generous value (well above the ~0.1 GEN a real deploy/write actually
# consumes) sidesteps needing per-call estimation for this test file.
FLAT_FEE_VALUE = 200_000_000_000_000_000  # 0.2 GEN


def _reverted(receipt: dict) -> bool:
    return receipt.get("tx_execution_result_name") == REVERTED_RESULT


@pytest.fixture(scope="module")
def factory(accounts):
    """Deploy a fresh VectorFactory with the real VectorBounty.py source
    embedded (get_bounty_code() serves it back to sponsors, guaranteeing
    they always deploy the exact source this factory expects), exactly as
    deploy/001_deploy_vector_factory.ts does for a real network
    deployment."""
    bounty_code = VECTOR_BOUNTY_PATH.read_text(encoding="utf-8")
    contract_factory = get_contract_factory(contract_file_path=str(VECTOR_FACTORY_PATH))
    return contract_factory.deploy(args=[bounty_code, 1], account=accounts[0], fee_value=FLAT_FEE_VALUE)


def _create_bounty(factory, sponsor, **overrides):
    """What the frontend does: deploy VectorBounty as an ordinary top-level
    transaction (sponsor is the direct signer, so gl.message.sender_address
    inside its __init__ is genuinely the sponsor -- no factory-hop needed
    any more), then register it. register_bounty cross-contract-reads the
    child's own get_bounty_info() -- this proves that real call path works
    live, not just that the two contracts compile."""
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

    bounty_factory = get_contract_factory(contract_file_path=str(VECTOR_BOUNTY_PATH))
    bounty = bounty_factory.deploy(
        args=[
            factory.address,
            args["title"],
            args["description"],
            args["target_url"],
            args["severity_critical_wei"],
            args["severity_high_wei"],
            args["severity_medium_wei"],
            args["severity_low_wei"],
            args["disclosure_bond_wei"],
        ],
        account=sponsor,
        fee_value=FLAT_FEE_VALUE,
    )

    receipt = (
        factory.connect(sponsor)
        .register_bounty(args=[bounty.address])
        .transact(value=1, fee_value=FLAT_FEE_VALUE)
    )
    assert not _reverted(receipt), f"register_bounty reverted: {receipt}"

    return bounty.address, bounty


def test_deploy_then_register_spawns_readable_child_contract(factory, accounts):
    sponsor = accounts[0]
    address_hex, bounty = _create_bounty(factory, sponsor)
    assert address_hex.startswith("0x")

    bounties = factory.get_bounties().call()
    assert address_hex in bounties

    meta = factory.get_bounty_meta(args=[address_hex]).call()
    assert meta["title"] == "Heartbleed disclosure integration probe"
    assert meta["sponsor"].lower() == sponsor.address.lower()

    info = bounty.get_bounty_info().call()
    assert info["status"] == "open"
    assert info["sponsor"].lower() == sponsor.address.lower()


def test_register_bounty_rejects_wrong_factory(factory, accounts):
    """A VectorBounty deployed pointing at some OTHER factory address must
    not be registerable here -- register_bounty's cross-contract read
    checks address_factory against gl.message.contract_address, not just
    that get_bounty_info() responds at all."""
    sponsor = accounts[0]
    wrong_factory_address = accounts[1].address  # any real address that isn't `factory`

    bounty_factory = get_contract_factory(contract_file_path=str(VECTOR_BOUNTY_PATH))
    bounty = bounty_factory.deploy(
        args=[
            wrong_factory_address,
            "Wrong-factory probe",
            "desc",
            TARGET_URL,
            "1000",
            "500",
            "200",
            "50",
            "10",
        ],
        account=sponsor,
        fee_value=FLAT_FEE_VALUE,
    )

    receipt = (
        factory.connect(sponsor)
        .register_bounty(args=[bounty.address])
        .transact(value=1, fee_value=FLAT_FEE_VALUE)
    )
    assert _reverted(receipt), "register_bounty must reject a bounty pointed at a different factory"


def test_factory_owner_is_informational_except_for_withdraw_fees(factory, accounts):
    """get_owner() gates exactly one thing (withdraw_fees) -- every other
    write (register_bounty) is intentionally permissionless, gated by the
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

    denied_receipt = factory.connect(outsider).withdraw_fees(args=[]).transact(fee_value=FLAT_FEE_VALUE)
    assert _reverted(denied_receipt), "withdraw_fees should revert for a non-owner caller"
    assert int(factory.get_collected_fees().call()) == after_create  # unchanged

    ok_receipt = factory.connect(owner).withdraw_fees(args=[]).transact(fee_value=FLAT_FEE_VALUE)
    assert not _reverted(ok_receipt), f"withdraw_fees reverted for the real owner: {ok_receipt}"
    assert int(factory.get_collected_fees().call()) == 0


def test_fund_and_reject_disclosure_end_to_end(factory, accounts):
    """A disclosure describing something the live target does NOT actually
    say must be rejected by real validator consensus, with its bond
    genuinely forfeited into the pool -- a real transfer, not a mocked one."""
    sponsor = accounts[0]
    researcher = accounts[1]
    _, bounty = _create_bounty(factory, sponsor)

    fund_receipt = bounty.connect(sponsor).fund_pool(args=[]).transact(value=5000, fee_value=FLAT_FEE_VALUE)
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
        .transact(value=10, fee_value=FLAT_FEE_VALUE)
    )
    assert not _reverted(submit_receipt), f"submit_disclosure reverted: {submit_receipt}"

    disclosures_before = bounty.get_disclosures().call()
    disclosure_id = disclosures_before[-1]

    triage_receipt = bounty.connect(researcher).triage(args=[disclosure_id]).transact(fee_value=FLAT_FEE_VALUE)
    assert not _reverted(triage_receipt), f"triage reverted: {triage_receipt}"

    record = bounty.get_disclosure(args=[disclosure_id]).call()
    assert record["status"] == "REJECTED"
    assert record["assigned_severity"] == ""

    info = bounty.get_bounty_info().call()
    assert int(info["pool_remaining"]) == 5010  # 5000 funded + 10 forfeited bond


def test_submit_and_verify_disclosure_end_to_end(factory, accounts):
    """End-to-end: deploy a VectorBounty directly, register it, submit a
    disclosure describing a real, stable, well-documented historical
    vulnerability against a live page that actually confirms it, and let a
    real Equivalence Principle consensus round verify it -- confirming bond
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
        .transact(value=10, fee_value=FLAT_FEE_VALUE)
    )
    assert not _reverted(submit_receipt), f"submit_disclosure reverted: {submit_receipt}"

    disclosure_id = bounty.get_disclosures().call()[-1]

    triage_receipt = bounty.connect(researcher).triage(args=[disclosure_id]).transact(fee_value=FLAT_FEE_VALUE)
    assert not _reverted(triage_receipt), f"triage reverted: {triage_receipt}"

    record = bounty.get_disclosure(args=[disclosure_id]).call()
    assert record["status"] == "VERIFIED"
    assert record["assigned_severity"] in ("critical", "high")  # model's own real-world severity call
    assert int(record["payout_wei"]) > 0
    assert int(record["challenge_window_ends_at"]) > 0
    assert record["evidence_snapshot"]  # real fetched content, non-empty

    assert disclosure_id in bounty.get_disclosures().call()


def test_sponsor_cannot_self_disclose(factory, accounts):
    """Live proof of the self-dealing fix (see SECURITY.md /
    docs/AUDIT.md finding 16): fund_pool() is permissionless, so a bounty's
    pool can hold third-party donations, and the sponsor must not be able
    to claim them via a self-submitted disclosure."""
    sponsor = accounts[0]
    _, bounty = _create_bounty(factory, sponsor)

    submit_receipt = (
        bounty.connect(sponsor)
        .submit_disclosure(
            args=["Self-dealing attempt", "desc", "repro", "target_ref", "low"]
        )
        .transact(value=10, fee_value=FLAT_FEE_VALUE)
    )
    assert _reverted(submit_receipt), "submit_disclosure must revert when sender == sponsor"
