"use client";

import { createContext, useContext, type ReactNode } from "react";

/** The same recovery actions, rendered inside whichever panel currently owns keyboard focus. */
const Recovery = createContext<ReactNode>(null);
export const SaveRecoveryProvider = Recovery.Provider;

export function SaveRecovery({ className = "" }: { className?: string }) {
  const recovery = useContext(Recovery);
  return recovery ? <div className={`my-3 shrink-0 ${className}`}>{recovery}</div> : null;
}
