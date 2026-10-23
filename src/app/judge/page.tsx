import type { Metadata } from "next";
import { ChogApp } from "@/components/app/ChogApp";

export const metadata: Metadata = {
  title: "Choglander · Judge desk",
  description: "Chog #642, the Hype Man, is already set up. Call, poke, ring in 30 seconds. Add ?reset=1 to start fresh.",
};

// The judge desk keeps its own saved state (apart from /), opens on Chog #375, and starts over with ?reset=1.
export default function JudgePage() {
  return <ChogApp judge />;
}
