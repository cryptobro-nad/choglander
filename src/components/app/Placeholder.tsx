// First paint, before the client app is ready. Server-rendered and static: a demo Chog in its arch
// and one line in its voice, so a slow phone never shows an empty sky. Render it with no <main>
// inside; globals.css hides it the moment any <main> (the app, onboarding, or the error screen) mounts.

export function Placeholder({ line = "Chog is picking up…" }: { line?: string }) {
  return (
    <div className="chog-placeholder" role="status" aria-live="polite">
      <div className="chog-breathe relative aspect-square w-[min(232px,60vw)]">
        <div className="absolute -bottom-3 left-[12%] right-[12%] h-7 rounded-full bg-[radial-gradient(ellipse,rgba(24,28,58,0.36),transparent_72%)] blur-md" />
        <div className="absolute inset-0 overflow-hidden rounded-[999px_999px_30px_30px] bg-[#c6e3a0] shadow-[0_28px_60px_-30px_rgba(24,30,72,0.7)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- static first-paint art, no loader */}
          <img src="/chog/642-thumb.webp" alt="" width={232} height={232} className="h-full w-full object-cover" />
          <div className="absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_5px_#fff]" />
        </div>
      </div>
      <p className="mt-8 rounded-full bg-white/75 px-5 py-2.5 font-serif text-[17px] text-ink italic shadow-[0_10px_30px_-18px_rgba(24,30,72,0.6)] backdrop-blur-sm">
        {line}
      </p>
    </div>
  );
}
