"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { GeometricMark, markForAddress } from "./GeometricMark";
import { formatGen, shortenAddress } from "@/lib/utils";
import type { BountyMeta } from "@/lib/vector-abi";

export function BountyCard({
  meta,
  status,
  index = 0,
}: {
  meta: BountyMeta;
  status?: "open" | "closed";
  index?: number;
}) {
  const mark = markForAddress(meta.address);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay: Math.min(index, 6) * 0.06 }}
    >
      <Link href={`/bounties/${meta.address}`} className="group block">
        <div className="yellow-block yellow-block-hover flex aspect-[4/3] items-center justify-center p-8 sm:aspect-[16/10]">
          <GeometricMark kind={mark} className="h-20 w-20 text-ink transition-transform duration-300 group-hover:scale-110 sm:h-24 sm:w-24" />
          {status && (
            <span className="absolute right-4 top-4 rounded-full bg-ink px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-wider text-paper">
              {status === "open" ? "Live" : "Closed"}
            </span>
          )}
        </div>
        <div className="mt-4">
          <h3 className="text-base font-semibold text-ink transition-colors group-hover:text-ink/70">
            {meta.title}
          </h3>
          <p className="mt-1.5 line-clamp-2 text-sm text-ink-soft">{meta.description || "No description provided."}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="meta-pill">Up to {formatGen(meta.severity_payouts.critical)} GEN</span>
            <span className="meta-pill font-mono normal-case tracking-normal">
              {shortenAddress(meta.address)}
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
