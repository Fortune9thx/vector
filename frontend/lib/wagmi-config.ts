import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { studioDevnet as studioDev } from "genlayer-js/chains";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

if (!projectId && typeof window !== "undefined") {
  console.warn(
    "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set -- the WalletConnect QR " +
      "flow won't work until you add one (see frontend/.env.local.example). " +
      "Browser-extension wallets (MetaMask, etc.) still connect fine."
  );
}

export const wagmiConfig = getDefaultConfig({
  appName: "Vector",
  // getDefaultConfig throws synchronously on a falsy projectId, which would
  // otherwise crash SSR/build entirely before a real one is configured --
  // fall back to a placeholder so the app (and every non-WalletConnect
  // connector) keeps working. This placeholder is a known non-issue for
  // this portfolio's audience, not an open gap.
  projectId: projectId || "00000000000000000000000000000000",
  chains: [studioDev],
  ssr: true,
});
