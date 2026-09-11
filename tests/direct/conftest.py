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
    cached SDK so tests key values exactly the way the contract itself
    does."""
    cache_root = Path.home() / ".cache" / "gltest-direct" / "extracted"
    for candidate in cache_root.glob("**/genlayer/py/types.py"):
        sdk_root = candidate.parents[2]
        if str(sdk_root) not in sys.path:
            sys.path.insert(0, str(sdk_root))
        from genlayer.py.types import Address
        return Address
    return None


_AddressCls = None


def warp_now(vm, iso_timestamp: str) -> None:
    """vm.warp() alone does not move a contract's notion of "now" for a
    contract already deployed: gltest's VMContext._refresh_gl_message
    (direct/vm.py) updates gl.message_raw's sender/origin/value on every
    vm.sender/vm.value change, but never touches gl.message_raw['datetime']
    -- and the method that would build a fresh copy including it,
    get_message_raw(), is dead code, never called anywhere in the installed
    gltest package. So gl.message_raw["datetime"], which _consensus_now()
    reads by deliberate design instead of Python's own datetime.now(), stays
    frozen at whatever it was when the contract was first imported. Patched
    here, scoped to tests only, matching the same gap documented in every
    prior GenLayer project built on this stack."""
    vm.warp(iso_timestamp)
    gl = sys.modules.get("genlayer.gl")
    if gl is not None and getattr(gl, "message_raw", None) is not None:
        gl.message_raw["datetime"] = iso_timestamp


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
    from gltest.direct import deploy_contract

    args = {**DEFAULT_BOUNTY_ARGS, **overrides}
    vm.sender = factory_addr
    return deploy_contract(
        VECTOR_BOUNTY_PATH,
        vm,
        to_hex(factory_addr),
        to_hex(sponsor_addr),
        args["title"],
        args["description"],
        args["target_url"],
        args["severity_critical_wei"],
        args["severity_high_wei"],
        args["severity_medium_wei"],
        args["severity_low_wei"],
        args["disclosure_bond_wei"],
    )


def web(body: str) -> dict:
    return {"method": "GET", "status": 200, "body": body}


def wrapped_json(payload: dict) -> str:
    """LLM responses are rarely bare JSON in practice -- wrap it in prose the
    way a real model would, forcing _parse_json_object's brace-stripping to
    actually do work rather than relying on the mock's own auto-parse."""
    return f"Here is my analysis.\n```json\n{json.dumps(payload)}\n```\nEnd of response."
