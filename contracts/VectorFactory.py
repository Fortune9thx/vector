# v0.3.0
# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

import json
import ipaddress
from urllib.parse import urlsplit

import genlayer as gl
from genlayer.types import *
from genlayer.storage import DynArray, TreeMap

MAX_TITLE_LEN = 140
MAX_DESC_LEN = 2000
MAX_URL_LEN = 500


def _consensus_now() -> int:
    """Unix timestamp via gl.vm.get_timestamp() -- the transaction's own
    consensus timestamp, not local wall clock."""
    return int(gl.vm.get_timestamp().timestamp())


def _normalize_address(addr: str) -> str:
    """Lowercase key form -- avoids comparing a checksummed stored key
    against raw caller input (a confirmed GenLayer rejection pattern)."""
    return addr.strip().lower()


def _is_safe_target_url(url_s: str) -> bool:
    """SSRF guard: every validator independently fetches this URL server-side
    (VectorBounty.triage's gl.nondet.web.render), so a caller-supplied target
    pointed at an internal/loopback/link-local address would make the whole
    validator set an unwitting port-scanner/internal-request proxy. Rejects
    localhost/*.localhost, literal IPv4/IPv6 hosts (including decimal/hex
    -encoded IPv4 forms ipaddress.ip_address() itself normalizes),
    private/loopback/link-local/reserved IP ranges, explicit ports, and
    embedded credentials. Assumes the caller already checked the http(s)://
    scheme prefix."""
    try:
        parts = urlsplit(url_s)
    except ValueError:
        return False
    if parts.username or parts.password:
        return False
    if parts.port is not None:
        return False
    host = (parts.hostname or "").lower()
    if not host:
        return False
    if host == "localhost" or host.endswith(".localhost"):
        return False
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip is not None and (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    ):
        return False
    # A bare all-digit host with no IP parse (e.g. an overflow-range decimal
    # form ipaddress rejects outright) is still an attempt at a numeric IP,
    # not a real hostname -- reject it too rather than let it through as
    # "not a recognized IP so presumably fine."
    if ip is None and host.replace(".", "").isdigit():
        return False
    return True


@gl.evm.contract_interface
class _Recipient:
    """Nameless-transfer interface used to pay out native GEN to a wallet."""

    class View:
        pass

    class Write:
        pass


class VectorFactory(gl.contract.Contract):
    """
    Registry + on-chain factory for Vector bounty programs (see
    docs/ARCHITECTURE.md). Registry metadata is creation-time only -- live
    disclosure state lives in each VectorBounty and must be read directly
    from it (cross-contract writes silently no-op on Bradbury).

    withdraw_fees() is the only privileged action in the whole system;
    create_bounty is permissionless, gated only by the creation stake.

    create_bounty captures the sponsor's address before deploy_contract and
    passes it explicitly to VectorBounty -- inside the child's own __init__,
    sender_address would resolve to this factory, not the human caller (see
    docs/AUDIT.md).
    """

    bounty_code: str
    creation_stake: u256
    owner: Address
    # GEN collected via create_bounty, not yet withdrawn.
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
    def create_bounty(
        self,
        title: str,
        description: str,
        target_url: str,
        severity_critical_wei: str,
        severity_high_wei: str,
        severity_medium_wei: str,
        severity_low_wei: str,
        disclosure_bond_wei: str,
    ) -> str:
        if gl.message.value < self.creation_stake:
            raise gl.vm.UserError(
                f"Creation stake too low: sent {gl.message.value}, requires {self.creation_stake}"
            )

        title_s = title.strip()
        if not title_s or len(title_s) > MAX_TITLE_LEN:
            raise gl.vm.UserError(f"Title is required and must be at most {MAX_TITLE_LEN} characters.")
        if len(description) > MAX_DESC_LEN:
            raise gl.vm.UserError(f"Description exceeds {MAX_DESC_LEN} characters.")
        url_s = target_url.strip()
        if not url_s or len(url_s) > MAX_URL_LEN or not (
            url_s.startswith("http://") or url_s.startswith("https://")
        ):
            raise gl.vm.UserError(f"target_url must be a non-empty http(s) URL, at most {MAX_URL_LEN} characters.")
        if not _is_safe_target_url(url_s):
            raise gl.vm.UserError("target_url must not target a localhost/private/internal address.")

        # Defense in depth -- re-validated inside VectorBounty.__init__ too,
        # since its source is public and deployable directly, bypassing
        # whatever limits only live here.
        try:
            critical = int(severity_critical_wei)
            high = int(severity_high_wei)
            medium = int(severity_medium_wei)
            low = int(severity_low_wei)
            bond = int(disclosure_bond_wei)
        except (TypeError, ValueError):
            raise gl.vm.UserError("Severity payouts and disclosure bond must be integer wei strings.")

        if low <= 0:
            raise gl.vm.UserError("severity_low_wei must be greater than zero.")
        if not (critical >= high >= medium >= low):
            raise gl.vm.UserError("Severity payouts must satisfy critical >= high >= medium >= low > 0.")
        if bond <= 0:
            raise gl.vm.UserError("disclosure_bond_wei must be greater than zero.")

        registered = len(self.bounties)
        # Captured here, in the factory's own execution context, where
        # sender_address is genuinely the human caller (a direct, single-hop
        # call) -- see class docstring.
        sponsor_hex = gl.message.sender_address.as_hex
        factory_hex = gl.message.contract_address.as_hex

        contract_address = gl.contract.deploy(
            code=self.bounty_code.encode("utf-8"),
            args=[
                factory_hex,
                sponsor_hex,
                title_s,
                description,
                url_s,
                str(critical),
                str(high),
                str(medium),
                str(low),
                str(bond),
            ],
            salt_nonce=registered + 1,
        )
        address_hex = contract_address.as_hex
        self.bounties.append(address_hex)

        amount = int(gl.message.value)
        self.collected_fees = u256(int(self.collected_fees) + amount)

        meta = {
            "address": address_hex,
            "title": title_s,
            "description": description,
            "target_url": url_s,
            "sponsor": sponsor_hex,
            "severity_payouts": {
                "critical": str(critical),
                "high": str(high),
                "medium": str(medium),
                "low": str(low),
            },
            "disclosure_bond": str(bond),
            "created_at": str(_consensus_now()),
            "creation_stake_paid": str(amount),
        }
        self.bounty_meta[_normalize_address(address_hex)] = json.dumps(meta)
        return address_hex

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
