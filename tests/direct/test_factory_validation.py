"""
Direct-mode tests for VectorFactory -- validation guard clauses, and the
withdraw_fees() recovery path.

Scope note: create_bounty's actual gl.deploy_contract call (spawning a child
VectorBounty) is NOT exercised here. gltest's direct-mode WASI mock has no
default handler for cross-contract DeployContract calls (confirmed by
reading gltest/direct/wasi_mock.py -- CallContract/DeployContract route
through an optional _gl_call_hook that only "glsim" mode installs, and this
gltest version ships no default implementation). Every guard clause below
reverts BEFORE the deploy_contract call is ever reached, so it's fully
testable in direct mode; the success path (a real spawned, readable child
VectorBounty) is integration-test-only -- see tests/integration/.
"""

from gltest.direct import VMContext, deploy_contract, create_test_addresses

from conftest import VECTOR_FACTORY_PATH, VECTOR_BOUNTY_PATH, to_hex

VALID_ARGS = ("Title", "Desc", "https://example.com/target", "1000", "500", "200", "50", "10")


def _deploy_factory(vm, owner, creation_stake=0):
    vm.sender = owner
    bounty_code = VECTOR_BOUNTY_PATH.read_text(encoding="utf-8")
    return deploy_contract(VECTOR_FACTORY_PATH, vm, bounty_code, creation_stake)


def test_factory_deploys_with_owner_and_stake():
    vm = VMContext()
    owner, = create_test_addresses(1)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=100)
        assert factory.get_creation_stake() == "100"
        assert factory.get_bounties_count() == 0
        assert factory.get_collected_fees() == "0"


def test_factory_requires_bounty_code():
    vm = VMContext()
    with vm.activate():
        with vm.expect_revert("Missing VectorBounty contract source"):
            deploy_contract(VECTOR_FACTORY_PATH, vm, "", 0)


def test_create_bounty_rejects_insufficient_stake():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=100)
        vm.sender = alice
        vm.value = 50
        with vm.expect_revert("stake too low"):
            factory.create_bounty(*VALID_ARGS)


def test_create_bounty_rejects_missing_title():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        vm.sender = alice
        vm.value = 0
        with vm.expect_revert("Title is required"):
            factory.create_bounty("", "Desc", "https://example.com/target", "1000", "500", "200", "50", "10")


def test_create_bounty_rejects_bad_url():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        vm.sender = alice
        vm.value = 0
        with vm.expect_revert("http(s)"):
            factory.create_bounty("Title", "Desc", "not-a-url", "1000", "500", "200", "50", "10")


def test_create_bounty_rejects_non_integer_severity():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        vm.sender = alice
        vm.value = 0
        with vm.expect_revert("integer wei strings"):
            factory.create_bounty("Title", "Desc", "https://example.com/t", "abc", "500", "200", "50", "10")


def test_create_bounty_rejects_severity_ordering_violation():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        vm.sender = alice
        vm.value = 0
        with vm.expect_revert("critical >= high >= medium >= low"):
            factory.create_bounty("Title", "Desc", "https://example.com/t", "100", "500", "200", "50", "10")


def test_create_bounty_rejects_zero_bond():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        vm.sender = alice
        vm.value = 0
        with vm.expect_revert("disclosure_bond_wei must be greater than zero"):
            factory.create_bounty("Title", "Desc", "https://example.com/t", "1000", "500", "200", "50", "0")


def test_get_owner_matches_deployer():
    vm = VMContext()
    owner, = create_test_addresses(1)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        assert factory.get_owner().lower() == to_hex(owner).lower()


def test_get_bounties_page_bounds():
    vm = VMContext()
    owner, = create_test_addresses(1)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        assert factory.get_bounties_page(0, 10) == []
        assert factory.get_bounties_page(-1, 10) == []
        assert factory.get_bounties_page(0, 0) == []


def test_get_bounty_meta_unknown_address_reverts():
    vm = VMContext()
    owner, someone = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        with vm.expect_revert("Unknown bounty address"):
            factory.get_bounty_meta(to_hex(someone))


# ------------------------------------------------------------------
# withdraw_fees() -- the factory-creation-fee recovery path
# ------------------------------------------------------------------


def test_withdraw_fees_only_owner():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        vm.sender = alice
        with vm.expect_revert("Only the factory owner"):
            factory.withdraw_fees()


def test_withdraw_fees_rejects_when_nothing_collected():
    vm = VMContext()
    owner, = create_test_addresses(1)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        vm.sender = owner
        with vm.expect_revert("No fees to withdraw"):
            factory.withdraw_fees()
