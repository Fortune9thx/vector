/**
 * Deployed VectorFactory contract address, keyed by network. Populated by
 * deploy/001_deploy_vector_factory.ts after a real deployment -- undefined
 * until then, in which case the app surfaces an explicit "not deployed yet"
 * state rather than a silently broken read.
 */
export type VectorNetworkKey = "bradbury" | "studio" | "studioDev" | "asimov";

export const VECTOR_FACTORY_ADDRESSES: Record<VectorNetworkKey, `0x${string}` | undefined> = {
  bradbury: undefined,
  studio: undefined,
  // Deployed 2026-09-11, tx 0x66e80b2fba4f830a0040d222c6b5dfaaa645aa1639c0e1d99c07f1dcec6cdd91,
  // FINALIZED with FINISHED_WITH_RETURN. This is the redesigned
  // deploy-then-register architecture (see VectorFactory's docstring):
  // create_bounty() -- which internally called gl.contract.deploy() -- was
  // removed entirely, because a Consensus v0.6 platform gap makes any
  // write that itself triggers an internal deploy/call message
  // unexecutable (confirmed live, three independent ways, unrelated to
  // this contract's own code -- see SECURITY.md). The sponsor now deploys
  // VectorBounty directly (get_bounty_code() serves the exact source),
  // then calls register_bounty(), a plain write with no internal deploy.
  // Live-verified end to end 2026-09-11: deploy -> register -> a
  // genuinely different researcher's submit_disclosure -> triage (real
  // web fetch + real LLM consensus, correctly REJECTED a claim the fetched
  // evidence didn't support).
  //
  // Superseded three prior deploys during this same investigation:
  // 0x59C12B2441eF18EE4CFa01e741F0B3143a06Ccc1 (redesign, but
  // gl.vm.get_timestamp() itself was separately confirmed live-broken --
  // SystemError: 2: inval on every call; fixed by switching
  // _consensus_now() to genlayer.message.raw["datetime"] instead -- see
  // SECURITY.md), 0x47c73afa388b40aAbd04CaB0bBB144bF5E97fAF5 (pre-redesign,
  // self-dealing + expire_unclaimed_payout fixes only), and
  // 0x42d37FD32982C8BD762EBaE69731d2dF832FDa5F (never actually deployed at
  // all -- FINISHED_WITH_ERROR from the runner-hash bug).
  //
  // Redeployed 2026-09-14, tx
  // 0x1b583ebf3be940c13fa3bceca559e18c9e62a31cc34350dc1d254bcf27c7d20c,
  // FINALIZED with FINISHED_WITH_RETURN, in direct response to a GenLayer
  // Portal steward review. Embeds the fixed VectorBounty.py: the
  // UNVERIFIABLE fund-lock fix, up-front worst-case pool reservation at
  // submission (closing a real payout-race gap), a staked/forfeitable
  // duplicate-challenge bond, retryable (never-forfeiting) handling of
  // malformed LLM output, and a commit-pin requirement for
  // raw.githubusercontent.com targets. See SECURITY.md and docs/AUDIT.md
  // findings 20-24 for the full writeup. Superseded
  // 0x99Af5CE83F0856185C80E82B642336270d8c55ab (pre-steward-review source).
  studioDev: "0x7C26A757a3838890e49EBB24036ceab1055A546a",
  asimov: undefined,
};

// Bradbury's FeeManager infrastructure is confirmed down as of 2026-09-11
// (messageFeeParamsBudgetFloor() reverting on the network's own contract --
// not a Vector-side issue). Deploying to GenLayer Studio Devnet instead
// per https://docs.genlayer.com/developers/consensus-v06-migration.
export const VECTOR_ACTIVE_NETWORK: VectorNetworkKey = "studioDev";

/**
 * Resolution order: an explicit env override (useful for pointing a local
 * dev build at a different deploy without editing this file) first, then
 * the address deploy/001_deploy_vector_factory.ts wrote here.
 */
export function getVectorFactoryAddress(): `0x${string}` | undefined {
  const override = process.env.NEXT_PUBLIC_VECTOR_FACTORY_ADDRESS;
  return (override || VECTOR_FACTORY_ADDRESSES[VECTOR_ACTIVE_NETWORK]) as `0x${string}` | undefined;
}

export function isVectorFactoryDeployed(): boolean {
  return Boolean(getVectorFactoryAddress());
}
