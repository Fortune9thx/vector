"""Direct-mode tests for submit_disclosure() and fund_pool()."""

from gltest.direct import VMContext, create_test_addresses

from conftest import deploy_bounty, to_hex

VALID = dict(
    title="XSS in comment field",
    description="Stored XSS via the comment form.",
    repro_steps="1. Post a comment containing <script>alert(1)</script>. 2. View the page.",
    target_ref="src/comments/render.py:42",
    claimed_severity="high",
)


def _submit(bounty, vm, sender, value=10, **overrides):
    vm.sender = sender
    vm.value = value
    args = {**VALID, **overrides}
    return bounty.submit_disclosure(
        args["title"], args["description"], args["repro_steps"], args["target_ref"], args["claimed_severity"]
    )


def test_submit_disclosure_persists_pending_status():
    vm = VMContext()
    factory, sponsor, researcher = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        disclosure_id = _submit(bounty, vm, researcher)
        record = bounty.get_disclosure(disclosure_id)
        assert record["status"] == "PENDING"
        assert record["researcher"].lower() == to_hex(researcher).lower()
        assert record["claimed_severity"] == "high"
        assert record["bond_wei"] == "10"
        assert record["fetch_attempts"] == 0

        info = bounty.get_bounty_info()
        assert info["disclosure_count"] == 1
        # The worst-case ("critical") payout is reserved immediately at
        # submission -- see test_submit_disclosure_reserves_worst_case_*
        # below for the full steward-finding regression coverage.
        assert record["reserved_wei"] == "1000"
        assert info["reserved_wei"] == "1000"


# ------------------------------------------------------------------
# Up-front worst-case reservation (steward finding: a valid claim must
# never fail or race another disclosure for the same shared pool)
# ------------------------------------------------------------------


def test_submit_disclosure_rejects_when_pool_cannot_cover_worst_case():
    vm = VMContext()
    factory, sponsor, researcher = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor, auto_fund_wei=0)
        vm.sender = researcher
        vm.value = 10
        with vm.expect_revert("does not currently have enough unreserved GEN"):
            bounty.submit_disclosure(
                VALID["title"], VALID["description"], VALID["repro_steps"], VALID["target_ref"], VALID["claimed_severity"]
            )


def test_submit_disclosure_reserves_worst_case_and_blocks_a_second_from_racing_it():
    """The exact scenario the steward flagged: two disclosures against a
    pool that can only cover ONE critical-severity payout must never both
    be accepted -- the second must fail up front, at submission, rather
    than both reaching VERIFIED and racing each other at claim time."""
    vm = VMContext()
    factory, sponsor, alice, bob = create_test_addresses(4)
    with vm.activate():
        # Exactly enough for one worst-case (critical=1000) payout.
        bounty = deploy_bounty(vm, factory, sponsor, auto_fund_wei=0)
        vm.sender = sponsor
        vm.value = 1000
        bounty.fund_pool()

        id_a = _submit(bounty, vm, alice)
        info = bounty.get_bounty_info()
        assert info["pool_remaining"] == "1000"
        assert info["reserved_wei"] == "1000"
        assert info["available_wei"] == "0"

        vm.sender = bob
        vm.value = 10
        with vm.expect_revert("does not currently have enough unreserved GEN"):
            bounty.submit_disclosure(
                VALID["title"], VALID["description"], VALID["repro_steps"], VALID["target_ref"], VALID["claimed_severity"]
            )
        # Confirms the rejection was real, not a partial state change.
        assert bounty.get_bounty_info()["disclosure_count"] == 1
        assert bounty.get_disclosure(id_a)["status"] == "PENDING"


def test_submit_disclosure_requires_open_bounty():
    vm = VMContext()
    factory, sponsor, researcher = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        vm.sender = sponsor
        bounty.close_bounty()
        with vm.expect_revert("Bounty is closed"):
            _submit(bounty, vm, researcher)


def test_submit_disclosure_rejects_sponsor_as_researcher():
    """fund_pool() is permissionless, so a bounty's pool can hold
    third-party donations -- without this check the sponsor could self
    -disclose a real-but-planted flaw on their own target and walk away
    with community-funded pool money. See docs/AUDIT.md."""
    vm = VMContext()
    factory, sponsor, third_party_funder = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        vm.sender = third_party_funder
        vm.value = 1000
        bounty.fund_pool()
        with vm.expect_revert("sponsor may not submit a disclosure"):
            _submit(bounty, vm, sponsor)


def test_submit_disclosure_requires_exact_bond_too_little():
    vm = VMContext()
    factory, sponsor, researcher = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        with vm.expect_revert("bond must be exactly"):
            _submit(bounty, vm, researcher, value=5)


def test_submit_disclosure_requires_exact_bond_too_much():
    vm = VMContext()
    factory, sponsor, researcher = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        with vm.expect_revert("bond must be exactly"):
            _submit(bounty, vm, researcher, value=20)


def test_submit_disclosure_requires_repro_steps():
    vm = VMContext()
    factory, sponsor, researcher = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        with vm.expect_revert("Reproduction steps are required"):
            _submit(bounty, vm, researcher, repro_steps="")


def test_submit_disclosure_requires_target_ref():
    vm = VMContext()
    factory, sponsor, researcher = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        with vm.expect_revert("target_ref is required"):
            _submit(bounty, vm, researcher, target_ref="")


def test_submit_disclosure_rejects_invalid_claimed_severity():
    vm = VMContext()
    factory, sponsor, researcher = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        with vm.expect_revert("claimed_severity must be one of"):
            _submit(bounty, vm, researcher, claimed_severity="catastrophic")


def test_disclosure_ids_increment():
    vm = VMContext()
    factory, sponsor, researcher = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        id_a = _submit(bounty, vm, researcher)
        id_b = _submit(bounty, vm, researcher)
        assert id_a == "0"
        assert id_b == "1"
        assert bounty.get_disclosures() == ["0", "1"]


def test_get_disclosures_by_researcher():
    vm = VMContext()
    factory, sponsor, alice, bob = create_test_addresses(4)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        _submit(bounty, vm, alice)
        _submit(bounty, vm, bob)
        alice_ds = bounty.get_disclosures_by_researcher(to_hex(alice))
        assert len(alice_ds) == 1
        assert alice_ds[0]["researcher"].lower() == to_hex(alice).lower()


# ------------------------------------------------------------------
# fund_pool()
# ------------------------------------------------------------------


def test_fund_pool_increases_pool_remaining():
    vm = VMContext()
    factory, sponsor, someone = create_test_addresses(3)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor, auto_fund_wei=0)
        vm.sender = someone
        vm.value = 5000
        bounty.fund_pool()
        assert bounty.get_bounty_info()["pool_remaining"] == "5000"

        # Permissionless -- a second, unrelated funder can top it up too.
        vm.sender = sponsor
        vm.value = 1000
        bounty.fund_pool()
        assert bounty.get_bounty_info()["pool_remaining"] == "6000"


def test_fund_pool_rejects_zero_value():
    vm = VMContext()
    factory, sponsor = create_test_addresses(2)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        vm.sender = sponsor
        vm.value = 0
        with vm.expect_revert("Must send GEN"):
            bounty.fund_pool()


def test_fund_pool_rejects_when_closed():
    vm = VMContext()
    factory, sponsor = create_test_addresses(2)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor)
        vm.sender = sponsor
        bounty.close_bounty()
        vm.value = 100
        with vm.expect_revert("Bounty is closed"):
            bounty.fund_pool()
