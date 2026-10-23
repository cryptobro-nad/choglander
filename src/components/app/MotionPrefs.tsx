"use client";

import { MotionConfig } from "framer-motion";

// With "reduce motion" set on the phone, every framer-motion sheet, screen and spring in the app
// changes without moving: opacity still fades, nothing slides or bounces.
export function MotionPrefs({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
