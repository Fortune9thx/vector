# v0.3.0
# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

import json

import genlayer as gl
from genlayer.types import *
from genlayer.storage import DynArray, TreeMap


def _normalize_address(addr: str) -> str:
    """Lowercase key form -- avoids comparing a checksummed stored key
    against raw caller input (a confirmed GenLayer rejection pattern)."""
    return addr.strip().lower()


@gl.evm.contract_interface
class _Recipient:
    """Nameless-transfer interface used to pay out native GEN to a wallet."""

    class View:
        pass

    class Write:
        pass


class VectorFactory(gl.contract.Contract):
    """
    Registry for Vector bounty programs (see docs/ARCHITECTURE.md).
    Registry metadata is creation-time only -- live disclosure state lives
    in each VectorBounty and must be read directly from it (cross-contract
    writes silently no-op).

    Deploy-then-register, not factory-deploys-child: a Consensus v0.6
    platform gap means any write that itself triggers an internal
    gl.contract.deploy() currently cannot complete (fee
    no_matching_allocation # internal -- confirmed live, unrelated to this
    contract's own code; see SECURITY.md). The sponsor deploys VectorBounty
    themselves as an ordinary top-level transaction (get_bounty_code()
    below returns the exact source to deploy, guaranteeing it always
    matches what this factory expects), then calls register_bounty() to
    list it. This also removes the old factory-hop sponsor-capture problem
    entirely: since the sponsor deploys directly, gl.message.sender_address
    inside VectorBounty.__init__ is already genuinely the human caller, no
    special-casing needed.

    withdraw_fees() is the only privileged action in the whole system;
    register_bounty is permissionless, gated only by the creation stake.
    """

    bounty_code: str
    creation_stake: u256
    owner: Address
    # GEN collected via register_bounty, not yet withdrawn.
    collected_fees: u256
    bounties: DynArray[str]
    # bounty_address_hex(normalized) -> JSON bounty metadata
    bounty_meta: TreeMap[str, str]

    def __init__(self, bounty_code: str, creation_stake: u256):
        if not bounty_code:
            raise gl.vm.UserError("Missing VectorBounty contract source code.")
        self.bounty_code = bounty_code
        self.creation_stake = creation_stake
        self.owner = gl.message.sender_address
        self.collected_fees = u256(0)

    @gl.public.write.payable
    def register_bounty(self, bounty_address: str) -> str:
        if gl.message.value < self.creation_stake:
            raise gl.vm.UserError(
                f"Creation stake too low: sent {gl.message.value}, requires {self.creation_stake}"
            )

        try:
            addr = Address(bounty_address)
        except Exception:
            raise gl.vm.UserError("bounty_address must be a valid address.")
        addr_hex = addr.as_hex
        key = _normalize_address(addr_hex)
        if self.bounty_meta.get(key, ""):
            raise gl.vm.UserError("This bounty address is already registered.")

        # Trust only what the deployed contract itself reports, never
        # caller-supplied metadata -- a cross-contract .view() read (a
        # synchronous call, not an async internal message, so it doesn't
        # hit the deploy-fee gap above) confirms this is a real VectorBounty
        # instance and pulls its actual constructor-validated state.
        info = gl.contract.get_at(addr).view().get_bounty_info()
        if _normalize_address(info["address_factory"]) != _normalize_address(
            gl.message.contract_address.as_hex
        ):
            raise gl.vm.UserError("bounty_address was not deployed against this factory.")

        self.bounties.append(addr_hex)

        amount = int(gl.message.value)
        self.collected_fees = u256(int(self.collected_fees) + amount)

        meta = {
            "address": addr_hex,
            "title": info["title"],
            "description": info["description"],
            "target_url": info["target_url"],
            "sponsor": info["sponsor"],
            "severity_payouts": info["severity_payouts"],
            "disclosure_bond": info["disclosure_bond"],
            "created_at": info["created_at"],
            "creation_stake_paid": str(amount),
        }
        self.bounty_meta[key] = json.dumps(meta)
        return addr_hex

    @gl.public.view
    def get_bounty_code(self) -> str:
        """The exact VectorBounty source to deploy before calling
        register_bounty -- fetched live so a sponsor's deploy always
        matches what this factory will accept, never a possibly-stale
        bundled copy."""
        return self.bounty_code

    @gl.public.write
    def withdraw_fees(self) -> None:
        if gl.message.sender_address.as_hex != self.owner.as_hex:
            raise gl.vm.UserError("Only the factory owner may withdraw collected fees.")
        amount = int(self.collected_fees)
        if amount == 0:
            raise gl.vm.UserError("No fees to withdraw.")
        # Effects before interaction.
        self.collected_fees = u256(0)
        _Recipient(self.owner).emit_transfer(value=u256(amount))

    @gl.public.view
    def get_owner(self) -> str:
        return self.owner.as_hex

    @gl.public.view
    def get_creation_stake(self) -> str:
        return str(int(self.creation_stake))

    @gl.public.view
    def get_collected_fees(self) -> str:
        return str(int(self.collected_fees))

    @gl.public.view
    def get_bounties(self) -> list[str]:
        return list(self.bounties)

    @gl.public.view
    def get_bounties_count(self) -> int:
        return len(self.bounties)

    @gl.public.view
    def get_bounties_page(self, offset: int, limit: int) -> list[str]:
        if offset < 0 or limit <= 0:
            return []
        addresses = list(self.bounties)
        return addresses[offset : offset + limit]

    @gl.public.view
    def get_bounty_meta(self, address: str) -> dict:
        raw = self.bounty_meta.get(_normalize_address(address), "")
        if not raw:
            raise gl.vm.UserError("Unknown bounty address.")
        return json.loads(raw)

    @gl.public.view
    def get_bounties_by_sponsor(self, sponsor: str) -> list[str]:
        target = _normalize_address(sponsor)
        matches = []
        for address_hex in self.bounties:
            raw = self.bounty_meta.get(_normalize_address(address_hex), "")
            if not raw:
                continue
            meta = json.loads(raw)
            if _normalize_address(meta.get("sponsor", "")) == target:
                matches.append(address_hex)
        return matches
