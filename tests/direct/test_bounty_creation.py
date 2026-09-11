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
        bounty = deploy_bounty(vm, factory, sponsor)
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
