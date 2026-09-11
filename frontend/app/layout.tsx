import type { Metadata } from "next";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "../styles/globals.css";
import { Providers } from "@/components/Providers";
import { AppNav } from "@/components/AppNav";

const interSans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const interTight = Inter_Tight({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vector — Verified Vulnerability Disclosure Escrow",
  description:
    "Security researchers disclose vulnerabilities against a live public target. GenLayer validators independently fetch the real target and verify the disclosure before any bounty pays out. No centralized triage team.",
};

// Every route depends on client-side wallet state (RainbowKit/wagmi), so
// there's nothing meaningful to statically prerender -- and
// getDefaultConfig throws at module-init time without a WalletConnect
// projectId, which would otherwise crash the build's static generation
// pass even though the app runs fine once a real projectId is set.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${interSans.variable} ${interTight.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <Providers>
          <AppNav />
          <main className="flex-1">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
