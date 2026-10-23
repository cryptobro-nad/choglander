import type { Metadata } from "next";
import Link from "next/link";
import { Sky } from "@/components/app/Sky";
import { Button } from "@/components/ui/button";

// A mistyped address (/Judge, /judge/x). Next's default 404 has no <main>, so the first-paint
// placeholder would sit over it forever; this one has a <main>, and the Chog answers the wrong number.

export const metadata: Metadata = { title: "Wrong number · Choglander" };

export default function NotFound() {
  return (
    <>
      <Sky phase="morning" />
      <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col items-center justify-center px-6 pt-safe pb-safe text-center text-ink">
        <div className="relative aspect-square w-[min(200px,52vw)] rotate-[4deg]">
          <div className="absolute inset-0 overflow-hidden rounded-[999px_999px_26px_26px] bg-[#c6e3a0] shadow-[0_24px_50px_-28px_rgba(24,30,72,0.7)]">
            {/* eslint-disable-next-line @next/next/no-img-element -- static art on the not-found screen */}
            <img src="/chog/642-thumb.webp" alt="" width={200} height={200} className="h-full w-full object-cover" />
            <div className="absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_5px_#fff]" />
          </div>
        </div>
        <p className="mt-8 text-[12px] font-semibold tracking-[0.2em] text-muted uppercase">Wrong number</p>
        <h1 className="mt-2 max-w-[14ch] font-serif text-[38px] leading-[0.98] font-medium tracking-tight text-balance">Nobody here by that name. Just me.</h1>
        <p className="mt-4 max-w-[30ch] text-[16px] leading-snug text-[#3b4270]">
          That address doesn’t ring anything. Hang up and try one of these.
        </p>
        <Button asChild className="mt-8 w-full max-w-[320px]" size="lg">
          <Link href="/judge">Open the judge desk</Link>
        </Button>
        <Link href="/" className="mt-2 grid h-11 place-items-center px-4 text-[14px] text-muted">
          Go to the app
        </Link>
      </main>
    </>
  );
}
