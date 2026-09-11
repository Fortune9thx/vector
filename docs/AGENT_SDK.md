# Agent SDK

A read/write reference for an autonomous vulnerability-scanning agent that wants to submit disclosures, monitor triage, and claim payouts against Vector programmatically — no frontend required. Every call below is a plain GenLayer contract call (`genlayer-js`, the `genlayer` CLI, or any GenLayer RPC client); nothing here is Vector-specific tooling.

## Discovering programs

```
VectorFactory.get_bounties() -> list[str]
```
Every deployed bounty program's address, oldest first. Page through large registries with:
```
VectorFactory.get_bounties_page(offset: int, limit: int) -> list[str]
```

```
VectorFactory.get_bounty_meta(address: str) -> dict
```
Creation-time metadata for one program: `title`, `description`, `target_url`, `sponsor`, `severity_payouts` (wei strings per level), `disclosure_bond` (wei string), `created_at`, `creation_stake_paid`. **This is static, creation-time-only data** — it never reflects a program's current pool balance, status, or disclosures. For live state, call the `VectorBounty` directly (see below).

## Reading a program's live state

```
VectorBounty.get_bounty_info() -> dict
```
Returns `status` (`"open"` | `"closed"`), `pool_remaining` (wei string), `disclosure_bond` (wei string), `severity_payouts`, `disclosure_count`, and static fields (`title`, `target_url`, `sponsor`, `created_at`).

Before submitting a disclosure, an agent should:
1. Confirm `status == "open"`.
2. Read `disclosure_bond` — this is the *exact* amount (in wei) the `submit_disclosure` call must send as `value`. Sending anything else reverts.

## Submitting a disclosure

```
VectorBounty.submit_disclosure(
  title: str,
  description: str,
  repro_steps: str,
  target_ref: str,
  claimed_severity: str,   # one of "critical" | "high" | "medium" | "low"
) -> str   # returns the new disclosure_id
```
Payable — `value` must exactly equal the bounty's current `disclosure_bond`. `target_ref` should be as specific as possible (a file path, function name, endpoint, or UI element) — this is what the triage validator checks for in the live-fetched target content, not the researcher's own narrative alone.

The returned transaction's execution result contains the new `disclosure_id`, but an agent that can't decode a method return value directly can instead read `VectorBounty.get_disclosures() -> list[str]` before and after the call — the new id is whatever is appended to the end of that list (it is a strictly increasing counter starting at `"0"`).

## Triggering triage

```
VectorBounty.triage(disclosure_id: str) -> None
```
Permissionless — any address can call this on a `PENDING` disclosure, including the researcher who submitted it. This is the heaviest call in the contract: a live web fetch plus an LLM reasoning round, independently re-run by every validator. Budget for real wall-clock latency (well beyond a typical write) and consider raising `consensusMaxRotations` above the SDK default of 3 if your client library exposes that option — more sequential nondet work per call means more surface for one slow validator to exhaust the default retry budget.

## Reading triage results

```
VectorBounty.get_disclosure(disclosure_id: str) -> dict
```
Full record, including `status`, `assigned_severity`, `payout_wei`, `evidence_snapshot` (the actual live-fetched content triage verified against — not the researcher's own claim), `reasoning`, `confidence`, `fetch_attempts`, and all the challenge/expiry timing fields.

An agent polling for a triage outcome should treat these as the only real terminal-for-this-round statuses to stop polling on: `VERIFIED`, `REJECTED`, `UNVERIFIABLE`. A disclosure that comes back `PENDING` after a `triage()` call means the target was unreachable and the attempt was retriable — call `triage()` again later, ideally with backoff, rather than assuming failure.

```
VectorBounty.get_disclosures_by_status(status: str) -> list[dict]
VectorBounty.get_disclosures_by_researcher(addr: str) -> list[dict]
```
Convenience queries for an agent tracking its own submissions, or scanning a program for all currently-`PENDING` work it could help triage.

## Duplicate challenges (optional, for agents doing prior-art review)

```
VectorBounty.challenge_duplicate(disclosure_id: str, prior_disclosure_id: str) -> None
VectorBounty.resolve_duplicate(disclosure_id: str) -> None
```
Only meaningful against a `VERIFIED` disclosure, within its 48-hour challenge window (`challenge_window_ends_at` on the disclosure record), with no challenge already open on it. `resolve_duplicate` is permissionless and safe to call speculatively — it reverts harmlessly with "No open challenge" if nothing is open.

## Claiming a payout

```
VectorBounty.finalize_payout(disclosure_id: str) -> None   # permissionless
VectorBounty.claim_payout(disclosure_id: str) -> None       # researcher-only
```
An agent should call `finalize_payout` once `challenge_window_ends_at` has passed with no open challenge (any address can do this — it moves no funds), then call `claim_payout` from the same address that originally submitted the disclosure. Check exactly how much is claimable first with:
```
VectorBounty.get_claimable(disclosure_id: str, addr: str) -> str   # wei, "0" if not currently claimable
```

## The escape hatch

```
VectorBounty.expire_disclosure(disclosure_id: str) -> None
```
Permissionless, callable on any disclosure still `PENDING` or `TRIAGING` once `expire_after` (7 days from submission) has passed. Always refunds the bond in full. An agent that submitted a disclosure and sees repeated `triage()` attempts fail to reach `VERIFIED`/`REJECTED`/`UNVERIFIABLE` after a week should call this to recover its bond rather than retrying indefinitely.

## A minimal agent loop

```
1. bounties = VectorFactory.get_bounties()
2. for addr in bounties:
     info = VectorBounty(addr).get_bounty_info()
     if info.status != "open": continue
     # ... run your own vulnerability scan against info.target_url ...
     if found_something:
       id = VectorBounty(addr).submit_disclosure(..., value=info.disclosure_bond)
       VectorBounty(addr).triage(id)
       poll get_disclosure(id) until status in {VERIFIED, REJECTED, UNVERIFIABLE}
       if status == VERIFIED:
         wait until now >= disclosure.challenge_window_ends_at
         VectorBounty(addr).finalize_payout(id)
         VectorBounty(addr).claim_payout(id)
```

All addresses passed to any Vector method should be normalized (lowercased) client-side before comparison if your own code needs to match against a stored `researcher`/`sponsor` field — every contract-side lookup does the same before storing or comparing.
