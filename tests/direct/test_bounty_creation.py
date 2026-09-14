"""Direct-mode tests for VectorBounty.__init__ validation.

VectorBounty is deployed directly here (not via VectorFactory) -- its source
is public and deployable on its own, so every constraint that matters must
be enforced in its own constructor, never assumed pre-checked by a factory
caller. See test_factory_validation.py for VectorFactory's own guard clauses.
"""

from gltest.direct import VMContext, create_test_addresses

from conftest import deploy_bounty, to_hex


def test_valid_bounty_deploys_open_with_correct_fields():
    vm = VMContext()
    factory, sponsor = create_test_addresses(2)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor, auto_fund_wei=0)
        info = bounty.get_bounty_info()
        assert info["status"] == "open"
        assert info["title"] == "Vector Test Target"
        assert info["target_url"] == "https://example.com/target"
        assert info["sponsor"].lower() == to_hex(sponsor).lower()
        assert info["address_factory"].lower() == to_hex(factory).lower()
        assert info["severity_payouts"] == {
            "critical": "1000",
            "high": "500",
            "medium": "200",
            "low": "50",
        }
        assert info["disclosure_bond"] == "10"
        assert info["pool_remaining"] == "0"
        assert info["reserved_wei"] == "0"
        assert info["available_wei"] == "0"
        assert info["disclosure_count"] == 0


def test_rejects_missing_title():
    vm = VMContext()
    factory, sponsor = create_test_addresses(2)
    with vm.activate():
        with vm.expect_revert("Title is required"):
            deploy_bounty(vm, factory, sponsor, title="")


def test_rejects_title_too_long():
    vm = VMContext()
    factory, sponsor = create_test_addresses(2)
    with vm.activate():
        with vm.expect_revert("Title is required"):
            deploy_bounty(vm, factory, sponsor, title="x" * 200)


def test_rejects_description_too_long():
    vm = VMContext()
    factory, sponsor = create_test_addresses(2)
    with vm.activate():
        with vm.expect_revert("Description exceeds"):
            deploy_bounty(vm, factory, sponsor, description="x" * 3000)


def test_rejects_non_http_target_url():
    vm = VMContext()
    factory, sponsor = create_test_addresses(2)
    with vm.activate():
        with vm.expect_revert("http(s)"):
            deploy_bounty(vm, factory, sponsor, target_url="ftp://example.com/repo")


def test_rejects_non_integer_severity_value():
    vm = VMContext()
    factory, sponsor = create_test_addresses(2)
    with vm.activate():
        with vm.expect_revert("integer wei strings"):
            deploy_bounty(vm, factory, sponsor, severity_critical_wei="not-a-number")


def test_rejects_severity_ordering_violation():
    vm = VMContext()
    factory, sponsor = create_test_addresses(2)
    with vm.activate():
        with vm.expect_revert("critical >= high >= medium >= low"):
            deploy_bounty(vm, factory, sponsor, severity_critical_wei="100", severity_high_wei="500")


def test_rejects_zero_low_severity():
    vm = VMContext()
    factory, sponsor = create_test_addresses(2)
    with vm.activate():
        with vm.expect_revert("severity_low_wei must be greater than zero"):
            deploy_bounty(vm, factory, sponsor, severity_low_wei="0")


def test_rejects_zero_disclosure_bond():
    vm = VMContext()
    factory, sponsor = create_test_addresses(2)
    with vm.activate():
        with vm.expect_revert("disclosure_bond_wei must be greater than zero"):
            deploy_bounty(vm, factory, sponsor, disclosure_bond_wei="0")


# ------------------------------------------------------------------
# Immutable-reference requirement for GitHub-hosted targets (steward
# finding: a sponsor-controlled mutable URL excerpt can be silently
# edited between submission and triage)
# ------------------------------------------------------------------


def test_rejects_github_raw_url_pinned_to_a_mutable_branch():
    vm = VMContext()
    factory, sponsor = create_test_addresses(2)
    with vm.activate():
        with vm.expect_revert("must pin a full 40-character commit SHA"):
            deploy_bounty(
                vm,
                factory,
                sponsor,
                target_url="https://raw.githubusercontent.com/example/repo/master/target.py",
            )


def test_rejects_github_raw_url_with_too_few_path_segments():
    vm = VMContext()
    factory, sponsor = create_test_addresses(2)
    with vm.activate():
        with vm.expect_revert("must include <owner>/<repo>/<ref>/<path>"):
            deploy_bounty(
                vm,
                factory,
                sponsor,
                target_url="https://raw.githubusercontent.com/example/repo",
            )


def test_accepts_github_raw_url_pinned_to_a_real_commit_sha():
    vm = VMContext()
    factory, sponsor = create_test_addresses(2)
    with vm.activate():
        sha = "a" * 40
        bounty = deploy_bounty(
            vm,
            factory,
            sponsor,
            auto_fund_wei=0,
            target_url=f"https://raw.githubusercontent.com/example/repo/{sha}/target.py",
        )
        assert bounty.get_bounty_info()["target_url"].endswith(f"/{sha}/target.py")


def test_non_github_live_url_is_unaffected_by_the_pin_requirement():
    """A genuinely live production endpoint's mutability is the whole point
    -- triage() must always check the CURRENT state of a real target, not
    a frozen snapshot. The pin requirement applies only to hosts that
    support a real immutable alternative (see _IMMUTABLE_REF_HOSTS)."""
    vm = VMContext()
    factory, sponsor = create_test_addresses(2)
    with vm.activate():
        bounty = deploy_bounty(vm, factory, sponsor, auto_fund_wei=0, target_url="https://example.com/live-target")
        assert bounty.get_bounty_info()["target_url"] == "https://example.com/live-target"
