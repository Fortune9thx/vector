"""
Direct-mode tests for challenge_duplicate() / resolve_duplicate() and their
interaction with finalize_payout(). Explicitly covers the requirement that a
DISTINCT verdict against ONE prior disclosure never blocks a later challenge
against a DIFFERENT prior disclosure.
"""

from datetime import datetime, timezone

from gltest.direct import VMContext, create_test_addresses

from conftest import deploy_bounty, warp_now, web, wrapped_json

DISCLOSURE = dict(
    title="SQLi in search endpoint",
    description="Unsanitized query param concatenated into SQL.",
    repro_steps="1. GET /search?q=' OR '1'='1. 2. Observe full table dump.",
    target_ref="src/search/handler.py:12",
    claimed_severity="high",
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


def _verify(bounty, vm, disclosure_id, researcher, severity="high", confidence="0.9", body="Vulnerable query builder."):
    vm.clear_mocks()
    vm.mock_web(r"example\.com/target", web(body))
    vm.mock_llm(
        r"triage verifier for Vector",
        wrapped_json({"is_real": True, "severity": severity, "confidence": confidence, "reasoning": "Confirmed."}),
    )
    vm.sender = researcher
    bounty.triage(disclosure_id)
    assert bounty.get_disclosure(disclosure_id)["status"] == "VERIFIED"


def _deploy_and_verify_two(vm, factory, sponsor, researcher_a, researcher_b):
    bounty = deploy_bounty(vm, factory, sponsor)
    id_a = _submit(bounty, vm, researcher_a)
    _verify(bounty, vm, id_a, researcher_a, body="First finding evidence.")
    id_b = _submit(bounty, vm, researcher_b)
    _verify(bounty, vm, id_b, researcher_b, body="Second finding evidence, similar bug.")
    return bounty, id_a, id_b


def test_challenge_requires_verified_status():
    vm = VMContext()
    factory, sponsor, alice, bob = create_test_addresses(4)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        id_a = _submit(bounty, vm, alice)
        id_b = _submit(bounty, vm, bob)
        vm.sender = bob
        with vm.expect_revert("Only a VERIFIED disclosure"):
            bounty.challenge_duplicate(id_a, id_b)


def test_challenge_requires_prior_to_be_a_real_verified_finding():
    vm = VMContext()
    factory, sponsor, alice, bob = create_test_addresses(4)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        id_a = _submit(bounty, vm, alice)
        _verify(bounty, vm, id_a, alice)
        id_b = _submit(bounty, vm, bob)  # still PENDING
        vm.sender = alice
        with vm.expect_revert("must be a real, previously-verified finding"):
            bounty.challenge_duplicate(id_a, id_b)


def test_challenge_rejects_self_challenge():
    vm = VMContext()
    factory, sponsor, alice = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        id_a = _submit(bounty, vm, alice)
        _verify(bounty, vm, id_a, alice)
        vm.sender = alice
        with vm.expect_revert("cannot be challenged against itself"):
            bounty.challenge_duplicate(id_a, id_a)


def test_challenge_rejects_after_window_closes():
    vm = VMContext()
    factory, sponsor, alice, bob = create_test_addresses(4)
    with vm.activate():
        bounty, id_a, id_b = _deploy_and_verify_two(vm, factory, sponsor, alice, bob)
        ends_at = int(bounty.get_disclosure(id_b)["challenge_window_ends_at"])
        warp_now(vm, _iso(ends_at + 60))
        vm.sender = alice
        with vm.expect_revert("challenge window has already closed"):
            bounty.challenge_duplicate(id_b, id_a)


def test_challenge_rejects_double_open_challenge():
    vm = VMContext()
    factory, sponsor, alice, bob = create_test_addresses(4)
    with vm.activate():
        bounty, id_a, id_b = _deploy_and_verify_two(vm, factory, sponsor, alice, bob)
        vm.sender = alice
        bounty.challenge_duplicate(id_b, id_a)
        with vm.expect_revert("already open"):
            bounty.challenge_duplicate(id_b, id_a)


def test_resolve_duplicate_same_marks_duplicate_and_clears_challenge():
    vm = VMContext()
    factory, sponsor, alice, bob = create_test_addresses(4)
    with vm.activate():
        bounty, id_a, id_b = _deploy_and_verify_two(vm, factory, sponsor, alice, bob)
        vm.sender = alice
        bounty.challenge_duplicate(id_b, id_a)

        vm.clear_mocks()
        vm.mock_llm(r"duplicate-adjudicator for Vector", wrapped_json({"verdict": "SAME", "reasoning": "Identical root cause."}))
        vm.sender = bob
        bounty.resolve_duplicate(id_b)

        record = bounty.get_disclosure(id_b)
        assert record["status"] == "DUPLICATE"
        assert record["duplicate_of"] == id_a
        # Challenge cleared -- resolving it again reverts with "no open challenge".
        with vm.expect_revert("No open challenge"):
            bounty.resolve_duplicate(id_b)


def test_resolve_duplicate_different_keeps_verified_and_clears_challenge():
    vm = VMContext()
    factory, sponsor, alice, bob = create_test_addresses(4)
    with vm.activate():
        bounty, id_a, id_b = _deploy_and_verify_two(vm, factory, sponsor, alice, bob)
        vm.sender = alice
        bounty.challenge_duplicate(id_b, id_a)

        vm.clear_mocks()
        vm.mock_llm(r"duplicate-adjudicator for Vector", wrapped_json({"verdict": "DIFFERENT", "reasoning": "Distinct bugs."}))
        vm.sender = bob
        bounty.resolve_duplicate(id_b)

        record = bounty.get_disclosure(id_b)
        assert record["status"] == "VERIFIED"
        assert record["duplicate_of"] == ""


def test_different_verdict_against_one_prior_does_not_block_challenge_against_another():
    """The spec-mandated regression test: resolving a challenge as DIFFERENT
    against ONE prior disclosure must never confirm global uniqueness -- the
    same disclosure must still be challengeable against a DIFFERENT prior."""
    vm = VMContext()
    factory, sponsor, alice, bob, carol = create_test_addresses(5)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        id_a = _submit(bounty, vm, alice)
        _verify(bounty, vm, id_a, alice, body="Finding A evidence.")
        id_b = _submit(bounty, vm, bob)
        _verify(bounty, vm, id_b, bob, body="Finding B evidence.")
        id_c = _submit(bounty, vm, carol)
        _verify(bounty, vm, id_c, carol, body="Finding C evidence, actually same as A.")

        # Challenge C against A -- resolved DIFFERENT.
        vm.sender = alice
        bounty.challenge_duplicate(id_c, id_a)
        vm.clear_mocks()
        vm.mock_llm(r"duplicate-adjudicator for Vector", wrapped_json({"verdict": "DIFFERENT", "reasoning": "Not the same as A."}))
        vm.sender = carol
        bounty.resolve_duplicate(id_c)
        assert bounty.get_disclosure(id_c)["status"] == "VERIFIED"

        # C can still be challenged again, this time against B -- proving the
        # DIFFERENT verdict against A did not confirm C's uniqueness globally.
        vm.sender = bob
        bounty.challenge_duplicate(id_c, id_b)
        vm.clear_mocks()
        vm.mock_llm(r"duplicate-adjudicator for Vector", wrapped_json({"verdict": "SAME", "reasoning": "Actually matches B."}))
        vm.sender = carol
        bounty.resolve_duplicate(id_c)

        record = bounty.get_disclosure(id_c)
        assert record["status"] == "DUPLICATE"
        assert record["duplicate_of"] == id_b


# ------------------------------------------------------------------
# finalize_payout() gating
# ------------------------------------------------------------------


def test_finalize_payout_blocked_before_window_elapses():
    vm = VMContext()
    factory, sponsor, alice = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        id_a = _submit(bounty, vm, alice)
        _verify(bounty, vm, id_a, alice)
        vm.sender = alice
        with vm.expect_revert("Challenge window has not yet elapsed"):
            bounty.finalize_payout(id_a)


def test_finalize_payout_blocked_while_challenge_open():
    vm = VMContext()
    factory, sponsor, alice, bob = create_test_addresses(4)
    with vm.activate():
        bounty, id_a, id_b = _deploy_and_verify_two(vm, factory, sponsor, alice, bob)
        vm.sender = alice
        bounty.challenge_duplicate(id_b, id_a)

        ends_at = int(bounty.get_disclosure(id_b)["challenge_window_ends_at"])
        warp_now(vm, _iso(ends_at + 60))
        vm.sender = bob
        with vm.expect_revert("unresolved duplicate challenge is open"):
            bounty.finalize_payout(id_b)


def test_finalize_payout_succeeds_after_window_with_no_challenge():
    vm = VMContext()
    factory, sponsor, alice = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        id_a = _submit(bounty, vm, alice)
        _verify(bounty, vm, id_a, alice)
        ends_at = int(bounty.get_disclosure(id_a)["challenge_window_ends_at"])
        warp_now(vm, _iso(ends_at + 60))
        vm.sender = alice
        bounty.finalize_payout(id_a)
        assert bounty.get_disclosure(id_a)["status"] == "PAYOUT_PENDING"
