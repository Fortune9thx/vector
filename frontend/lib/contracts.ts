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
  // Deployed 2026-09-11, tx 0xd06ce3dc462c2314312c7de1d260c71934c6058a9434d18a194e499b71290486,
  // FINALIZED with FINISHED_WITH_RETURN. Superseded a prior deploy at
  // 0x5AfCA3DE9C99B55ba194762782E3EF44a9eFB475 (tx 0xcbdc7f5c0019a865d259b8d34748f689742e689f499377058a992b4f90ba6403)
  // to embed the fixed VectorBounty (sponsor self-dealing block +
  // expire_unclaimed_payout) as its bounty_code constructor arg -- see
  // SECURITY.md / docs/AUDIT.md findings 16-17. That prior address's own
  // predecessor, 0x42d37FD32982C8BD762EBaE69731d2dF832FDa5F, never actually
  // deployed at all (FINISHED_WITH_ERROR from the runner-hash bug).
  //
  // KNOWN LIVE BLOCKER as of 2026-09-11: create_bounty() cannot currently
  // be called end-to-end on studio-dev via the standard SDK fee flow --
  // both client.estimateTransactionFees() and
  // estimateTransactionFeesForWrite() fail for this specific write
  // ("fee no_matching_allocation # internal" / server-side "execution
  // failed" respectively), because create_bounty's internal
  // gl.contract.deploy() call has no working fee-allocation path yet. This
  // is a platform-level gap unrelated to this contract's own code -- see
  // SECURITY.md.
  studioDev: "0x47c73afa388b40aAbd04CaB0bBB144bF5E97fAF5",
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
