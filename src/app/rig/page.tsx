import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RigBoard } from "@/app/rig/RigBoard";

// /rig: the portrait debug board (RigBoard). A tool for development, not part of the app, and nothing
// links to it: a production build answers 404, unless it was built with CHOG_DEBUG_PAGES=1 to check
// the rig on a deployed build.

export const metadata: Metadata = { title: "Rig", robots: { index: false, follow: false } };

export default function RigPage() {
  if (process.env.NODE_ENV === "production" && process.env.CHOG_DEBUG_PAGES !== "1") notFound();
  return <RigBoard />;
}
