"""
Direct-mode tests for VectorFactory -- constructor validation, the
register_bounty() guard clauses reachable before its cross-contract call,
and the withdraw_fees() recovery path.

Scope note: register_bounty()'s cross-contract gl.contract.get_at(...).view()
call (reading back a deployed VectorBounty's own state, see VectorFactory's
docstring for why the design is deploy-then-register rather than
factory-deploys-child) is NOT exercised here. gltest's direct-mode WASI mock
has no default handler for CallContract -- confirmed by reading
gltest/direct/wasi_mock.py: cross-contract calls route through an optional
vm._gl_call_hook that only "glsim" mode installs, and this gltest version
ships no default implementation, same underlying gap that made the
pre-redesign create_bounty()'s deploy_contract call untestable here too.
Every guard clause below reverts BEFORE that cross-contract call is ever
reached, so it's fully testable in direct mode; the full register_bounty
success path (a real deployed child read back and registered) is
integration-test-only -- see tests/integration/.
"""

from gltest.direct import VMContext, deploy_contract, create_test_addresses

from conftest import VECTOR_FACTORY_PATH, VECTOR_BOUNTY_PATH, to_hex


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


def test_get_bounty_code_returns_exact_source():
    """The exact source a sponsor must deploy before register_bounty() will
    accept it -- fetched live so a client never bundles a possibly-stale
    copy."""
    vm = VMContext()
    owner, = create_test_addresses(1)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        bounty_code = VECTOR_BOUNTY_PATH.read_text(encoding="utf-8")
        assert factory.get_bounty_code() == bounty_code


def test_register_bounty_rejects_insufficient_stake():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=100)
        vm.sender = alice
        vm.value = 50
        with vm.expect_revert("stake too low"):
            factory.register_bounty(to_hex(alice))


def test_register_bounty_rejects_invalid_address():
    vm = VMContext()
    owner, alice = create_test_addresses(2)
    with vm.activate():
        factory = _deploy_factory(vm, owner, creation_stake=0)
        vm.sender = alice
        vm.value = 0
        with vm.expect_revert("must be a valid address"):
            factory.register_bounty("not-an-address")


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
