"""Direct-mode tests for close_bounty() and withdraw_unused_pool()."""

from datetime import datetime, timezone

import pytest
from gltest.direct import VMContext, create_test_addresses

from conftest import WARP_ACROSS_CALLS_UNSUPPORTED, deploy_bounty, warp_now, web, wrapped_json

DISCLOSURE = dict(
    title="Open redirect",
    description="Unvalidated redirect target param.",
    repro_steps="1. Visit /go?to=evil.example. 2. Land on attacker page.",
    target_ref="src/routes/redirect.py:9",
    claimed_severity="low",
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


def test_close_bounty_only_sponsor():
    vm = VMContext()
    factory, sponsor, mallory = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        vm.sender = mallory
        with vm.expect_revert("Only the sponsor may close"):
            bounty.close_bounty()


def test_close_bounty_rejects_double_close():
    vm = VMContext()
    factory, sponsor = create_test_addresses(2)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        vm.sender = sponsor
        bounty.close_bounty()
        with vm.expect_revert("already closed"):
            bounty.close_bounty()


@pytest.mark.skip(reason=WARP_ACROSS_CALLS_UNSUPPORTED)
def test_close_bounty_blocks_new_disclosures_but_not_existing_ones():
    vm = VMContext()
    factory, sponsor, alice = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        id_a = _submit(bounty, vm, alice)

        vm.sender = sponsor
        bounty.close_bounty()

        vm.sender = alice
        vm.value = 10
        with vm.expect_revert("Bounty is closed"):
            bounty.submit_disclosure("T", "D", "Repro", "ref", "low")

        # The already in-flight disclosure can still be triaged/expired
        # normally -- closing a bounty must never strand it.
        expire_after = int(bounty.get_disclosure(id_a)["expire_after"])
        warp_now(vm, _iso(expire_after + 60))
        vm.sender = alice
        bounty.expire_disclosure(id_a)
        assert bounty.get_disclosure(id_a)["status"] == "EXPIRED"


def test_withdraw_unused_pool_requires_closed():
    vm = VMContext()
    factory, sponsor = create_test_addresses(2)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        vm.sender = sponsor
        with vm.expect_revert("must be closed"):
            bounty.withdraw_unused_pool()


def test_withdraw_unused_pool_only_sponsor():
    vm = VMContext()
    factory, sponsor, mallory = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        vm.sender = sponsor
        bounty.close_bounty()
        vm.sender = mallory
        with vm.expect_revert("Only the sponsor may withdraw"):
            bounty.withdraw_unused_pool()


def test_withdraw_unused_pool_blocked_while_disclosure_non_terminal():
    vm = VMContext()
    factory, sponsor, alice = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        vm.sender = sponsor
        vm.value = 1000
        bounty.fund_pool()

        _submit(bounty, vm, alice)  # left PENDING, non-terminal
        vm.sender = sponsor
        bounty.close_bounty()
        with vm.expect_revert("cannot withdraw while any disclosure is non-terminal"):
            bounty.withdraw_unused_pool()


def test_withdraw_unused_pool_succeeds_when_all_terminal():
    vm = VMContext()
    factory, sponsor, alice = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        vm.sender = sponsor
        vm.value = 1000
        bounty.fund_pool()

        id_a = _submit(bounty, vm, alice)
        vm.mock_web(r"example\.com/target", web("Nothing wrong here."))
        vm.mock_llm(
            r"triage verifier for Vector",
            wrapped_json({"is_real": False, "severity": "none", "confidence": "0.9", "reasoning": "No issue."}),
        )
        vm.sender = alice
        bounty.triage(id_a)  # -> REJECTED, terminal

        vm.sender = sponsor
        bounty.close_bounty()
        bounty.withdraw_unused_pool()
        # Pool included the sponsor's 1000 funding plus the forfeited 10 bond.
        assert bounty.get_bounty_info()["pool_remaining"] == "0"


def test_withdraw_unused_pool_rejects_when_nothing_remaining():
    vm = VMContext()
    factory, sponsor = create_test_addresses(2)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        vm.sender = sponsor
        bounty.close_bounty()
        with vm.expect_revert("No pool funds remaining"):
            bounty.withdraw_unused_pool()
