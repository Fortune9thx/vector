"""
Direct-mode tests for VectorBounty.triage() -- the Intelligent Contract
heart. Covers the fail-closed no-evidence retry-then-unverifiable path, the
low-confidence and genuine-rejection paths, genuine verification, and
Equivalence Principle validator independence.
"""

from conftest import deploy_bounty, warp_now, web, wrapped_json
from gltest.direct import VMContext, create_test_addresses

DISCLOSURE = dict(
    title="RCE in upload handler",
    description="Unsanitized filename passed to os.system in the upload handler.",
    repro_steps="1. Upload a file named `; touch pwned;`.py. 2. Observe command execution.",
    target_ref="src/upload/handler.py:88",
    claimed_severity="critical",
)


def _submit(bounty, vm, sender, value=10, **overrides):
    vm.sender = sender
    vm.value = value
    args = {**DISCLOSURE, **overrides}
    return bounty.submit_disclosure(
        args["title"], args["description"], args["repro_steps"], args["target_ref"], args["claimed_severity"]
    )


def _mock_target(vm, body="def handle_upload(f): os.system(f.name)"):
    vm.mock_web(r"example\.com/target", web(body))


def test_triage_fails_closed_when_target_unfetchable_and_stays_pending_retriable():
    vm = VMContext()
    factory, sponsor, researcher = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        disclosure_id = _submit(bounty, vm, researcher)
        # Deliberately no vm.mock_web registered -- the WASI mock returns an
        # empty body for any unmocked URL.
        vm.sender = researcher
        bounty.triage(disclosure_id)

        record = bounty.get_disclosure(disclosure_id)
        assert record["status"] == "PENDING"
        assert record["fetch_attempts"] == 1


def test_triage_becomes_unverifiable_after_max_attempts_and_24h():
    vm = VMContext()
    factory, sponsor, researcher = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        disclosure_id = _submit(bounty, vm, researcher)
        submitted_at = int(bounty.get_disclosure(disclosure_id)["submitted_at"])

        vm.sender = researcher
        bounty.triage(disclosure_id)
        bounty.triage(disclosure_id)
        assert bounty.get_disclosure(disclosure_id)["status"] == "PENDING"

        # Third attempt, but before 24h has elapsed -- must stay retriable,
        # proving BOTH conditions (max attempts AND 24h) are required, not
        # attempts alone.
        warp_now(vm, _iso(submitted_at + 3600))
        bounty.triage(disclosure_id)
        record = bounty.get_disclosure(disclosure_id)
        assert record["status"] == "PENDING"
        assert record["fetch_attempts"] == 3

        # A fourth attempt after 24h has elapsed now trips UNVERIFIABLE.
        warp_now(vm, _iso(submitted_at + 86400 + 60))
        bounty.triage(disclosure_id)
        record = bounty.get_disclosure(disclosure_id)
        assert record["status"] == "UNVERIFIABLE"


def _iso(unix_ts: int) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(unix_ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def test_triage_rejects_low_confidence():
    vm = VMContext()
    factory, sponsor, researcher = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        disclosure_id = _submit(bounty, vm, researcher)
        _mock_target(vm)
        vm.mock_llm(
            r"triage verifier for Vector",
            wrapped_json({"is_real": True, "severity": "critical", "confidence": "0.2", "reasoning": "Unsure."}),
        )
        vm.sender = researcher
        bounty.triage(disclosure_id)
        record = bounty.get_disclosure(disclosure_id)
        assert record["status"] == "REJECTED"
        assert bounty.get_bounty_info()["pool_remaining"] == "10"  # bond forfeited


def test_triage_rejects_when_not_real():
    vm = VMContext()
    factory, sponsor, researcher = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        disclosure_id = _submit(bounty, vm, researcher)
        _mock_target(vm, "A perfectly ordinary, safe upload handler.")
        vm.mock_llm(
            r"triage verifier for Vector",
            wrapped_json({"is_real": False, "severity": "none", "confidence": "0.95", "reasoning": "No such flaw."}),
        )
        vm.sender = researcher
        bounty.triage(disclosure_id)
        record = bounty.get_disclosure(disclosure_id)
        assert record["status"] == "REJECTED"
        assert record["assigned_severity"] == ""


def test_triage_verifies_genuine_disclosure_refunds_bond_and_sets_payout():
    vm = VMContext()
    factory, sponsor, researcher = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        vm.sender = sponsor
        vm.value = 5000
        bounty.fund_pool()

        disclosure_id = _submit(bounty, vm, researcher)
        _mock_target(vm)
        vm.mock_llm(
            r"triage verifier for Vector",
            wrapped_json({
                "is_real": True,
                "severity": "critical",
                "confidence": "0.93",
                "reasoning": "The handler passes the filename straight to os.system.",
            }),
        )
        vm.sender = researcher
        bounty.triage(disclosure_id)

        record = bounty.get_disclosure(disclosure_id)
        assert record["status"] == "VERIFIED"
        assert record["assigned_severity"] == "critical"
        assert record["payout_wei"] == "1000"
        assert int(record["challenge_window_ends_at"]) > 0
        assert "os.system" in record["evidence_snapshot"]
        # Pool untouched by verification itself -- payout is claimed
        # separately, later, via finalize_payout + claim_payout.
        assert bounty.get_bounty_info()["pool_remaining"] == "5000"


def test_evidence_snapshot_bound_to_real_content_not_llm_self_report():
    """Regression test for the "evidence not bound to actual content" failure
    class: even if the LLM's own JSON response claims to have seen fabricated
    text, the stored evidence_snapshot must reflect what was actually
    fetched, never the model's self-report -- because the contract never
    asks the model to report it at all."""
    vm = VMContext()
    factory, sponsor, researcher = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        disclosure_id = _submit(bounty, vm, researcher)
        _mock_target(vm, "The real, actually-fetched handler code says X.")
        vm.mock_llm(
            r"triage verifier for Vector",
            wrapped_json({
                "is_real": True,
                "severity": "high",
                "confidence": "0.8",
                "reasoning": "Fits.",
                "evidence_snapshot": "This text was never fetched from anywhere.",
            }),
        )
        vm.sender = researcher
        bounty.triage(disclosure_id)
        record = bounty.get_disclosure(disclosure_id)
        assert "actually-fetched handler code" in record["evidence_snapshot"]
        assert "never fetched from anywhere" not in record["evidence_snapshot"]


def test_triage_requires_pending_status():
    vm = VMContext()
    factory, sponsor, researcher = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        disclosure_id = _submit(bounty, vm, researcher)
        _mock_target(vm, "Not real.")
        vm.mock_llm(
            r"triage verifier for Vector",
            wrapped_json({"is_real": False, "severity": "none", "confidence": "0.9", "reasoning": "No."}),
        )
        vm.sender = researcher
        bounty.triage(disclosure_id)
        with vm.expect_revert("not pending triage"):
            bounty.triage(disclosure_id)


def test_confidence_bare_float_never_crashes():
    """Regression test for the calldata-has-no-float class of bug: even if
    the LLM returns confidence as a bare JSON number, the contract must
    coerce it to a string before it can cross a calldata boundary."""
    vm = VMContext()
    factory, sponsor, researcher = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        disclosure_id = _submit(bounty, vm, researcher)
        _mock_target(vm)
        vm.mock_llm(
            r"triage verifier for Vector",
            wrapped_json({"is_real": True, "severity": "medium", "confidence": 0.7, "reasoning": "Fits."}),
        )
        vm.sender = researcher
        bounty.triage(disclosure_id)
        record = bounty.get_disclosure(disclosure_id)
        assert record["confidence"] == "0.7"
        assert isinstance(record["confidence"], str)


# ------------------------------------------------------------------
# Equivalence Principle -- validator independence
# ------------------------------------------------------------------


def test_validator_agrees_on_matching_verdict():
    vm = VMContext()
    factory, sponsor, researcher = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        disclosure_id = _submit(bounty, vm, researcher)
        _mock_target(vm)
        vm.mock_llm(
            r"triage verifier for Vector",
            wrapped_json({"is_real": True, "severity": "high", "confidence": "0.85", "reasoning": "Fits."}),
        )
        vm.sender = researcher
        bounty.triage(disclosure_id)

        assert vm.run_validator() is True


def test_validator_agrees_on_matching_no_evidence_outcome():
    vm = VMContext()
    factory, sponsor, researcher = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        disclosure_id = _submit(bounty, vm, researcher)
        vm.sender = researcher
        bounty.triage(disclosure_id)

        assert vm.run_validator() is True


def test_validator_disagrees_on_different_severity():
    vm = VMContext()
    factory, sponsor, researcher = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        disclosure_id = _submit(bounty, vm, researcher)
        _mock_target(vm)
        vm.mock_llm(
            r"triage verifier for Vector",
            wrapped_json({"is_real": True, "severity": "critical", "confidence": "0.85", "reasoning": "Fits."}),
        )
        vm.sender = researcher
        bounty.triage(disclosure_id)

        disagrees = vm.run_validator(leader_result={
            "decision": "verdict", "is_real": True, "severity": "low",
            "confidence": "0.85", "reasoning": "Different.", "evidence_snapshot": "x",
        })
        assert disagrees is False


def test_validator_disagrees_on_confidence_outside_tolerance():
    vm = VMContext()
    factory, sponsor, researcher = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        disclosure_id = _submit(bounty, vm, researcher)
        _mock_target(vm)
        vm.mock_llm(
            r"triage verifier for Vector",
            wrapped_json({"is_real": True, "severity": "high", "confidence": "0.90", "reasoning": "Fits."}),
        )
        vm.sender = researcher
        bounty.triage(disclosure_id)

        disagrees = vm.run_validator(leader_result={
            "decision": "verdict", "is_real": True, "severity": "high",
            "confidence": "0.10", "reasoning": "Barely.", "evidence_snapshot": "x",
        })
        assert disagrees is False
