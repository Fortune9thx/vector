"""Direct-mode tests for expire_disclosure(), finalize_payout(), and
claim_payout() -- the bond/payout settlement paths."""

from datetime import datetime, timezone

from gltest.direct import VMContext, create_test_addresses

from conftest import deploy_bounty, warp_now, web, wrapped_json

DISCLOSURE = dict(
    title="IDOR in account settings",
    description="Sequential account IDs allow reading other users' settings.",
    repro_steps="1. GET /api/accounts/124/settings while authenticated as 123. 2. Data leaks.",
    target_ref="src/api/accounts.py:55",
    claimed_severity="medium",
)


def _iso(unix_ts: int) -> str:
    return datetime.fromtimestamp(unix_ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _submit(bounty, vm, sender, value=10, **overrides):
    vm.sender = sender
    vm.value = value
    args = {**DISCLOSURE, **overrides}
    return bounty.submit_disclosure(
        args["title"], args["description"], args["repro_steps"], args["target_ref"], args["claimed_severity"]
    )


def _verify(bounty, vm, disclosure_id, researcher, severity="medium", body="Evidence of the IDOR."):
    vm.clear_mocks()
    vm.mock_web(r"example\.com/target", web(body))
    vm.mock_llm(
        r"triage verifier for Vector",
        wrapped_json({"is_real": True, "severity": severity, "confidence": "0.9", "reasoning": "Confirmed."}),
    )
    vm.sender = researcher
    bounty.triage(disclosure_id)


# ------------------------------------------------------------------
# expire_disclosure()
# ------------------------------------------------------------------


def test_expire_disclosure_before_timeout_reverts():
    vm = VMContext()
    factory, sponsor, alice = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        id_a = _submit(bounty, vm, alice)
        vm.sender = alice
        with vm.expect_revert("not yet eligible to expire"):
            bounty.expire_disclosure(id_a)


def test_expire_disclosure_after_timeout_refunds_bond():
    vm = VMContext()
    factory, sponsor, alice = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        id_a = _submit(bounty, vm, alice)
        expire_after = int(bounty.get_disclosure(id_a)["expire_after"])
        warp_now(vm, _iso(expire_after + 60))
        vm.sender = alice
        bounty.expire_disclosure(id_a)
        record = bounty.get_disclosure(id_a)
        assert record["status"] == "EXPIRED"
        # Pool untouched -- expiry never forfeits, regardless of merit.
        assert bounty.get_bounty_info()["pool_remaining"] == "0"


def test_expire_disclosure_rejects_already_verified():
    vm = VMContext()
    factory, sponsor, alice = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        id_a = _submit(bounty, vm, alice)
        _verify(bounty, vm, id_a, alice)
        expire_after = int(bounty.get_disclosure(id_a)["expire_after"])
        warp_now(vm, _iso(expire_after + 60))
        vm.sender = alice
        with vm.expect_revert("Only a still-pending or in-triage disclosure"):
            bounty.expire_disclosure(id_a)


# ------------------------------------------------------------------
# claim_payout()
# ------------------------------------------------------------------


def _verified_and_finalized(vm, factory, sponsor, researcher, pool=5000):
    bounty = deploy_bounty(vm, factory, sponsor)
    vm.sender = sponsor
    vm.value = pool
    bounty.fund_pool()

    disclosure_id = _submit(bounty, vm, researcher)
    _verify(bounty, vm, disclosure_id, researcher)
    ends_at = int(bounty.get_disclosure(disclosure_id)["challenge_window_ends_at"])
    warp_now(vm, _iso(ends_at + 60))
    vm.sender = researcher
    bounty.finalize_payout(disclosure_id)
    return bounty, disclosure_id


def test_claim_payout_full_flow():
    vm = VMContext()
    factory, sponsor, alice = create_test_addresses(3)
    with vm.activate():
        bounty, disclosure_id = _verified_and_finalized(vm, factory, sponsor, alice)
        assert bounty.get_disclosure(disclosure_id)["status"] == "PAYOUT_PENDING"
        assert bounty.get_claimable(disclosure_id, _hex(alice)) == "200"  # medium tier
        assert bounty.is_claimed(disclosure_id) is False

        vm.sender = alice
        bounty.claim_payout(disclosure_id)

        record = bounty.get_disclosure(disclosure_id)
        assert record["status"] == "PAID"
        assert bounty.is_claimed(disclosure_id) is True
        assert bounty.get_bounty_info()["pool_remaining"] == "4800"


def _hex(addr):
    from conftest import to_hex

    return to_hex(addr)


def test_claim_payout_rejects_double_claim():
    vm = VMContext()
    factory, sponsor, alice = create_test_addresses(3)
    with vm.activate():
        bounty, disclosure_id = _verified_and_finalized(vm, factory, sponsor, alice)
        vm.sender = alice
        bounty.claim_payout(disclosure_id)
        with vm.expect_revert("already claimed"):
            bounty.claim_payout(disclosure_id)


def test_claim_payout_rejects_non_researcher():
    vm = VMContext()
    factory, sponsor, alice, mallory = create_test_addresses(4)
    with vm.activate():
        bounty, disclosure_id = _verified_and_finalized(vm, factory, sponsor, alice)
        vm.sender = mallory
        with vm.expect_revert("Only the disclosure's own researcher"):
            bounty.claim_payout(disclosure_id)


def test_claim_payout_rejects_before_payout_pending():
    vm = VMContext()
    factory, sponsor, alice = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        id_a = _submit(bounty, vm, alice)
        _verify(bounty, vm, id_a, alice)
        vm.sender = alice
        with vm.expect_revert("not payout-pending"):
            bounty.claim_payout(id_a)


def test_claim_payout_rejects_when_pool_underfunded():
    vm = VMContext()
    factory, sponsor, alice = create_test_addresses(3)
    with vm.activate():
        # No fund_pool() call at all -- pool_remaining stays 0.
        bounty = deploy_bounty(vm, factory, sponsor)
        id_a = _submit(bounty, vm, alice)
        _verify(bounty, vm, id_a, alice)
        ends_at = int(bounty.get_disclosure(id_a)["challenge_window_ends_at"])
        warp_now(vm, _iso(ends_at + 60))
        vm.sender = alice
        bounty.finalize_payout(id_a)
        assert bounty.get_claimable(id_a, _hex(alice)) == "0"
        with vm.expect_revert("temporarily underfunded"):
            bounty.claim_payout(id_a)

        # Top up the pool -- claim now succeeds without any other state change.
        vm.sender = sponsor
        vm.value = 1000
        bounty.fund_pool()
        vm.sender = alice
        bounty.claim_payout(id_a)
        assert bounty.get_disclosure(id_a)["status"] == "PAID"


# ------------------------------------------------------------------
# expire_unclaimed_payout() -- bounded liveness backstop, see docs/AUDIT.md
# ------------------------------------------------------------------


def test_expire_unclaimed_payout_before_timeout_reverts():
    vm = VMContext()
    factory, sponsor, alice = create_test_addresses(3)
    with vm.activate():
        bounty, disclosure_id = _verified_and_finalized(vm, factory, sponsor, alice)
        vm.sender = sponsor
        with vm.expect_revert("not yet eligible to expire"):
            bounty.expire_unclaimed_payout(disclosure_id)


def test_expire_unclaimed_payout_rejects_non_payout_pending():
    vm = VMContext()
    factory, sponsor, alice = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        id_a = _submit(bounty, vm, alice)
        vm.sender = sponsor
        with vm.expect_revert("not payout-pending"):
            bounty.expire_unclaimed_payout(id_a)


def test_expire_unclaimed_payout_after_timeout_unblocks_pool_withdrawal():
    """The whole point: a researcher who never claims must not permanently
    strand the sponsor's ability to withdraw_unused_pool once everything
    else has resolved."""
    vm = VMContext()
    factory, sponsor, alice = create_test_addresses(3)
    with vm.activate():
        bounty, disclosure_id = _verified_and_finalized(vm, factory, sponsor, alice, pool=1000)
        pending_at = int(bounty.get_disclosure(disclosure_id)["payout_pending_at"])
        assert pending_at > 0

        vm.sender = sponsor
        bounty.close_bounty()
        with vm.expect_revert("still PAYOUT_PENDING"):
            bounty.withdraw_unused_pool()

        warp_now(vm, _iso(pending_at + 2592000 + 60))  # PAYOUT_CLAIM_TIMEOUT_SECONDS + slack
        vm.sender = sponsor
        bounty.expire_unclaimed_payout(disclosure_id)
        assert bounty.get_disclosure(disclosure_id)["status"] == "EXPIRED"

        # Never moved any GEN -- pool_remaining is untouched, so this is
        # exactly the amount the sponsor funded, still fully withdrawable.
        assert bounty.get_bounty_info()["pool_remaining"] == "1000"
        bounty.withdraw_unused_pool()
        assert bounty.get_bounty_info()["pool_remaining"] == "0"

        # Claiming after expiry is still correctly rejected -- the payout
        # was never actually made claimable-forever, just terminal.
        vm.sender = alice
        with vm.expect_revert("not payout-pending"):
            bounty.claim_payout(disclosure_id)
