"use client";

import { useEffect } from "react";
import { Sky } from "@/components/app/Sky";
import { Button } from "@/components/ui/button";

// Something in the app threw. The Chog takes the blame, keeps the user's data where it is,
// and offers to call back (retry the segment) before falling back to a full reload.

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <Sky phase="morning" />
      <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col items-center justify-center px-6 pt-safe pb-safe text-center text-ink">
        <div className="relative aspect-square w-[min(200px,52vw)] -rotate-[5deg]">
          <div className="absolute inset-0 overflow-hidden rounded-[999px_999px_26px_26px] bg-[#c6e3a0] shadow-[0_24px_50px_-28px_rgba(24,30,72,0.7)]">
            {/* eslint-disable-next-line @next/next/no-img-element -- static art on the error screen */}
            <img src="/chog/642-thumb.webp" alt="" width={200} height={200} className="h-full w-full object-cover" />
            <div className="absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_5px_#fff]" />
          </div>
        </div>
        <p className="mt-8 text-[12px] font-semibold tracking-[0.2em] text-muted uppercase">Call dropped</p>
        <h1 className="mt-2 max-w-[14ch] font-serif text-[38px] leading-[0.98] font-medium tracking-tight">That was me. I sat on the phone.</h1>
        <p className="mt-4 max-w-[30ch] text-[16px] leading-snug text-[#3b4270]">
          Your alarm, calendar and everything I remember are still on this phone. Let me try that again.
        </p>
        <Button className="mt-8 w-full max-w-[320px]" size="lg" onClick={() => retry()}>
          Call me back
        </Button>
        <button type="button" className="mt-2 h-11 px-4 text-[14px] text-muted" onClick={() => window.location.reload()}>
          Reload the app
        </button>
      </main>
    </>
  );
}
