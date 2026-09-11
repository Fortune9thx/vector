"""
Direct-mode test fixtures for Vector contracts.

Applies one Windows-only monkeypatch documented from prior GenLayer projects
on this machine: gltest's direct-mode loader unlinks a temp file that is
still open via os.dup2 on this platform, raising PermissionError (harmless
on POSIX, where the same test suite runs clean). This patch never touches
contract code or the real SDK -- it only relaxes cleanup of a test-harness
temp file.
"""

import json
import os
import sys
from pathlib import Path

import pytest

CONTRACTS_DIR = Path(__file__).resolve().parents[2] / "contracts"
VECTOR_BOUNTY_PATH = CONTRACTS_DIR / "VectorBounty.py"
VECTOR_FACTORY_PATH = CONTRACTS_DIR / "VectorFactory.py"

_real_unlink = os.unlink


def _safe_unlink(path, *args, **kwargs):
    try:
        _real_unlink(path, *args, **kwargs)
    except PermissionError:
        pass


os.unlink = _safe_unlink


@pytest.fixture
def bounty_source() -> str:
    return VECTOR_BOUNTY_PATH.read_text(encoding="utf-8")


def _find_real_address_cls():
    """create_test_addresses()/create_address() fall back to plain bytes in
    this environment because `genlayer` isn't on sys.path until a contract
    has actually been deployed once (gltest wires SDK paths lazily inside
    load_contract_class). Address.as_hex is NOT plain lowercase hex -- it is
    an EIP-55 Keccak256 checksum, so a naive "0x" + bytes.hex() fallback
    silently produces the WRONG key and every TreeMap[str, str] lookup keyed
    by an address misses. Import the real Address class straight from the
    cached SDK so tests key values exactly the way the contract itself does.

    Only searches under extracted/local/ (this pinned hash's own cache),
    never the broader extracted/ tree: gltest also caches older SDK
    generations there (pre-v0.3.0 releases expose Address at
    genlayer/py/types.py; this pinned hash's real one is at
    genlayer/types/__init__.py). A version-agnostic glob previously matched
    one of those stale genlayer/py/types.py copies first and inserted its
    sdk_root into sys.path[0] -- shadowing the correct module tree for the
    rest of the process and breaking the very first contract import of a
    session with "No module named 'genlayer.types'"/"'genlayer.py'"
    (confirmed live; fixed by scoping the search to local/ and the current
    genlayer/types/__init__.py path)."""
    cache_root = Path.home() / ".cache" / "gltest-direct" / "extracted" / "local"
    for candidate in cache_root.glob("**/genlayer/types/__init__.py"):
        sdk_root = candidate.parents[2]
        if str(sdk_root) not in sys.path:
            sys.path.insert(0, str(sdk_root))
        from genlayer.types import Address
        return Address
    return None


_AddressCls = None


def warp_now(vm, iso_timestamp: str) -> None:
    """Dead in practice as of the v0.3.0 migration: _consensus_now() now
    reads gl.vm.get_timestamp() (a GetTimestamp VM call), which gltest's
    WASI mock does not implement at all yet -- it returns None regardless
    of vm.warp(), so there is no gl.message_raw-style attribute left to
    monkeypatch the way the pre-migration version of this helper did. Every
    caller of this function already deploys a VectorBounty first via
    deploy_bounty(), which now skips before warp_now() would ever be
    reached (see SECURITY.md). Kept only so a future gltest release that
    adds GetTimestamp support has an obvious place to wire a real patch;
    deliberately not "fixed" with a fake-clock workaround in the meantime,
    since that would risk testing the patch's clock instead of the
    contract's real logic."""
    vm.warp(iso_timestamp)


def to_hex(addr) -> str:
    """Normalize a create_test_addresses()/create_address() value (real
    Address or raw bytes fallback) to the exact checksummed 0x-hex string
    the contract's own `gl.message.sender_address.as_hex` produces."""
    if hasattr(addr, "as_hex"):
        return addr.as_hex
    global _AddressCls
    if _AddressCls is None:
        _AddressCls = _find_real_address_cls()
    if _AddressCls is not None:
        return _AddressCls(addr).as_hex
    return "0x" + addr.hex()


# ----------------------------------------------------------------------------
# Shared VectorBounty deploy helper -- its constructor is long enough
# (factory, sponsor, title, description, target_url, four severity tiers,
# bond) that every test file benefits from one shared default set with
# per-test overrides, rather than repeating the full arg list everywhere.
# ----------------------------------------------------------------------------

DEFAULT_BOUNTY_ARGS = dict(
    title="Vector Test Target",
    description="A test bounty program.",
    target_url="https://example.com/target",
    severity_critical_wei="1000",
    severity_high_wei="500",
    severity_medium_wei="200",
    severity_low_wei="50",
    disclosure_bond_wei="10",
)


def deploy_bounty(vm, factory_addr, sponsor_addr, **overrides):
    """factory_addr is purely informational here (VectorBounty.__init__
    just stores it as self.factory) -- direct-mode never deploys a real
    VectorFactory to cross-check against. sponsor_addr is who actually
    deploys: post-redesign, the sponsor deploys VectorBounty themselves (see
    VectorFactory's docstring for why), so gl.message.sender_address is the
    real sponsor with no constructor arg needed for it at all."""
    from gltest.direct import deploy_contract

    args = {**DEFAULT_BOUNTY_ARGS, **overrides}
    vm.sender = sponsor_addr
    try:
        return deploy_contract(
            VECTOR_BOUNTY_PATH,
            vm,
            to_hex(factory_addr),
            args["title"],
            args["description"],
            args["target_url"],
            args["severity_critical_wei"],
            args["severity_high_wei"],
            args["severity_medium_wei"],
            args["severity_low_wei"],
            args["disclosure_bond_wei"],
        )
    except AttributeError as exc:
        # gltest's WASI mock does not implement GetTimestamp yet, so
        # gl.vm.get_timestamp() -- which VectorBounty.__init__ calls via
        # _consensus_now() -- returns None in every direct-mode deploy. This
        # is an upstream toolchain gap (see SECURITY.md), not a contract
        # bug: skip rather than fail, and re-raise anything that isn't this
        # exact known failure so an unrelated AttributeError still surfaces.
        if "NoneType' object has no attribute 'timestamp'" in str(exc):
            pytest.skip(
                "Blocked by gltest's missing GetTimestamp mock (gl.vm.get_timestamp() "
                "returns None in direct-mode) -- see SECURITY.md. Not a contract bug; "
                "needs either an upstream gltest fix or a live/integration-network run."
            )
        raise


WARP_ACROSS_CALLS_UNSUPPORTED = (
    "gltest's direct-mode loader imports the contract module once at deploy "
    "time, and genlayer.message's `raw` dict (which _consensus_now() reads) "
    "is populated by top-level module code that runs on that one import -- "
    "so it never reflects a later vm.warp() call within the same test, "
    "unlike the real VM, where every call is a fresh process reading its "
    "own fresh message payload (confirmed live: repeated calls each see a "
    "correct, current timestamp). This is a narrower version of the "
    "GetTimestamp gap above -- a toolchain limitation, not a contract bug. "
    "See SECURITY.md."
)


def web(body: str) -> dict:
    return {"method": "GET", "status": 200, "body": body}


def wrapped_json(payload: dict) -> str:
    """LLM responses are rarely bare JSON in practice -- wrap it in prose the
    way a real model would, forcing _parse_json_object's brace-stripping to
    actually do work rather than relying on the mock's own auto-parse."""
    return f"Here is my analysis.\n```json\n{json.dumps(payload)}\n```\nEnd of response."
