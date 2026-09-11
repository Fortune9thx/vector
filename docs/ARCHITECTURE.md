# Architecture

## Two contracts, factory pattern

Vector is two Intelligent Contracts:

- **`VectorFactory`** — deployed once. A registry + on-chain factory. `create_bounty()` deploys a fresh `VectorBounty` for each program via `gl.contract.deploy`, gated only by an economic creation stake (never an admin allowlist). Its own `bounty_meta` registry stores creation-time metadata only (title, description, target URL, sponsor, severity payouts, disclosure bond) — it never changes after deploy.
- **`VectorBounty`** — deployed once per bounty program, holding that program's own payout pool, disclosure records, and the full triage state machine. Every live-changing fact about a program (pool balance, disclosure statuses, evidence) lives here, not in the factory.

This mirrors the factory/registry pattern used across this account's prior GenLayer builds (Lens, Helm): a lightweight, permissionless spawner in front of many independent instances, rather than one monolithic contract holding every program's state in nested maps.

## Why the factory can't just forward funds

`create_bounty()` takes a creation stake (paid to the factory, recoverable by the factory owner via `withdraw_fees()`), but a bounty's actual payout pool is funded separately, directly against the `VectorBounty`'s own address via `fund_pool()`. This is a deliberate design constraint, not an oversight: native-value transfers **to** another Intelligent Contract (as opposed to a real externally-owned wallet) are a documented, confirmed-broken pattern on GenLayer — money forwarded through the factory at creation time would need exactly this kind of contract-to-contract transfer. A human wallet paying a `VectorBounty` directly is a normal, proven payable call, so pool funding is designed around that constraint from the start. `fund_pool()` is permissionless, so a sponsor, co-sponsor, or community members can all top it up.

## Pull-based architecture

Vector's payout path is deliberately split into two steps for the same underlying reason:

1. `finalize_payout(disclosure_id)` — permissionless. Anyone can call this once a verified disclosure's 48-hour duplicate-challenge window has elapsed with no open challenge. It flips the disclosure's status to `PAYOUT_PENDING` — it does **not** move any funds.
2. `claim_payout(disclosure_id)` — researcher-only. The disclosure's own researcher pulls their payout whenever they choose.

This split exists so that a third party calling the permissionless `finalize_payout()` step never *forces* a transfer to happen on someone else's behalf. Pull-based payment is the safer default any time a permissionless step precedes a value transfer.

## Cross-contract write limitations

Confirmed, repeated finding across this account's prior GenLayer builds: a write issued via `.emit()` against another Intelligent Contract reaches consensus (`ACCEPTED`) but the target contract's own state silently never changes. Vector's design accounts for this in two places:

- **The factory never learns about a bounty's live state.** `VectorFactory.bounty_meta` is populated once, at `create_bounty()` time, and never touched again. There is no mechanism (and no attempt) for a `VectorBounty` to write its own status back to the factory. Any UI or agent that needs a bounty's live status must read it directly from the `VectorBounty` contract, not from the factory's registry entry.
- **Pool funding bypasses the factory entirely** (see above) rather than accepting funds at `create_bounty()` time and forwarding them on.

## Address propagation across `gl.contract.deploy`

A subtlety worth documenting explicitly: inside `VectorBounty.__init__` during a factory-issued `gl.contract.deploy` call, `gl.message.sender_address` resolves to the **factory's own contract address**, not the human who called `create_bounty()`. Per the GenVM message model — `contract_address` is the contract currently executing, `sender_address` is the immediate caller, `origin_address` is the original transaction signer — the immediate caller inside a freshly-deployed child contract's constructor is always whatever contract issued the `deploy` call, not the original human.

`VectorFactory.create_bounty()` works around this by capturing `gl.message.sender_address.as_hex` **before** calling `gl.contract.deploy`, in the factory's own execution context (where `sender_address` genuinely is the human caller, since it's a direct, single-hop call), and passing it explicitly as a constructor argument (`sponsor_hex`) to `VectorBounty`. Relying on `sender_address` inside the child's own `__init__` would silently record the factory as the sponsor, breaking every subsequent sponsor-only access check (`close_bounty`, `withdraw_unused_pool`) for every legitimate human caller.

## Storage model

Every contract uses only `TreeMap[str, str]` (JSON-encoded values) and `DynArray[str]`, matching the flat-primitive pattern used across every prior live contract on this account. No `@allow_storage` dataclass TreeMap value type — see `docs/AUDIT.md` for the full rationale.
