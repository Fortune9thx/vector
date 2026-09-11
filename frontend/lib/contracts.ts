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
  // 0x42d37FD32982C8BD762EBaE69731d2dF832FDa5F reached FINALIZED on
  // 2026-09-11 but with txExecutionResultName: "FINISHED_WITH_ERROR" --
  // reached consensus on a REVERT, never actually deployed (confirmed:
  // contract not found on every subsequent read). The deploy script's
  // own success check was fixed after this (see git history) to catch
  // this class of bug going forward -- see deploy/001_deploy_vector_factory.ts.
  studioDev: undefined,
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
