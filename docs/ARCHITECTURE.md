# Architecture

## Two contracts, deploy-then-register (not factory-deploys-child)

Vector is two Intelligent Contracts:

- **`VectorFactory`** — deployed once. A registry for Vector bounty programs. `get_bounty_code()` serves the exact `VectorBounty` source a sponsor must deploy; `register_bounty(bounty_address)` — gated only by an economic creation stake, never an admin allowlist — cross-contract-reads the already-deployed child's own `get_bounty_info()` and lists it. Its `bounty_meta` registry stores that creation-time metadata (title, description, target URL, sponsor, severity payouts, disclosure bond) — pulled from the child's real state, never from register_bounty's caller, and never touched again after registration.
- **`VectorBounty`** — deployed once per bounty program, directly by its sponsor (not by the factory), holding that program's own payout pool, disclosure records, and the full triage state machine. Every live-changing fact about a program (pool balance, disclosure statuses, evidence) lives here, not in the factory.

This is a **registry**, not a **factory** in the literal sense any more: the factory never calls `gl.contract.deploy()` itself. That's a deliberate redesign, not the original plan -- see "Why the factory doesn't deploy the child" below. It still mirrors the lightweight-spawner-in-front-of-many-independent-instances shape used across this account's prior GenLayer builds (Lens, Helm), just with the deploy step relocated to the sponsor's own wallet.

## Why the factory doesn't deploy the child

The original design *did* have `VectorFactory.create_bounty()` call `gl.contract.deploy()` directly, matching the classic factory pattern. Live testing found a genuine Consensus v0.6 platform gap: any write that itself triggers an internal `gl.contract.deploy()`/call message has no working fee-allocation path right now (confirmed three independent ways across two SDKs -- see `SECURITY.md`), so `create_bounty()` could never actually complete.

Top-level deploys (an EOA deploying a contract directly) don't hit this gap -- confirmed via two real `VectorFactory` deploys this session. So bounty creation became two steps instead of one:

1. The sponsor calls `get_bounty_code()` and deploys the returned source themselves, as an ordinary top-level transaction, passing the factory's address and the bounty's parameters as constructor args.
2. The sponsor calls `register_bounty(bounty_address)` on the factory, paying the creation stake. The factory never trusts what the sponsor claims about the new bounty -- it reads the deployed contract's own `get_bounty_info()` via `gl.contract.get_at(addr).view()` and stores *that*.

This turned out to be a strict improvement, not just a workaround: since the sponsor deploys directly, `gl.message.sender_address` inside `VectorBounty.__init__` is already genuinely the human sponsor. The old design's entire "factory captures the sponsor's address before deploying, because the child would otherwise see the factory as its caller" problem (documented in earlier revisions of this file) no longer exists -- there's no factory-mediated deploy hop left to cause it.

## Why the factory can't just forward funds

`register_bounty()` takes a creation stake (paid to the factory, recoverable by the factory owner via `withdraw_fees()`), but a bounty's actual payout pool is funded separately, directly against the `VectorBounty`'s own address via `fund_pool()`. This is a deliberate design constraint, not an oversight: native-value transfers **to** another Intelligent Contract (as opposed to a real externally-owned wallet) are a documented, confirmed-broken pattern on GenLayer — money forwarded through the factory at creation time would need exactly this kind of contract-to-contract transfer. A human wallet paying a `VectorBounty` directly is a normal, proven payable call, so pool funding is designed around that constraint from the start. `fund_pool()` is permissionless, so a sponsor, co-sponsor, or community members can all top it up.

## Pull-based architecture

Vector's payout path is deliberately split into two steps for the same underlying reason:

1. `finalize_payout(disclosure_id)` — permissionless. Anyone can call this once a verified disclosure's 48-hour duplicate-challenge window has elapsed with no open challenge. It flips the disclosure's status to `PAYOUT_PENDING` — it does **not** move any funds.
2. `claim_payout(disclosure_id)` — researcher-only. The disclosure's own researcher pulls their payout whenever they choose.

This split exists so that a third party calling the permissionless `finalize_payout()` step never *forces* a transfer to happen on someone else's behalf. Pull-based payment is the safer default any time a permissionless step precedes a value transfer.

## Cross-contract write limitations

Confirmed, repeated finding across this account's prior GenLayer builds: a write issued via `.emit()` against another Intelligent Contract reaches consensus (`ACCEPTED`) but the target contract's own state silently never changes. Vector's design accounts for this in two places:

- **The factory never learns about a bounty's live state.** `VectorFactory.bounty_meta` is populated once, at `register_bounty()` time, and never touched again. There is no mechanism (and no attempt) for a `VectorBounty` to write its own status back to the factory. Any UI or agent that needs a bounty's live status must read it directly from the `VectorBounty` contract, not from the factory's registry entry.
- **Pool funding bypasses the factory entirely** (see above) rather than accepting funds at registration time and forwarding them on.

## Storage model

Every contract uses only `TreeMap[str, str]` (JSON-encoded values) and `DynArray[str]`, matching the flat-primitive pattern used across every prior live contract on this account. No `@allow_storage` dataclass TreeMap value type — see `docs/AUDIT.md` for the full rationale.
