import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AnswerCall } from "@/app/c/AnswerCall";
import { readSharedCard, shortLine } from "@/app/c/share";
import { Button } from "@/components/ui/button";
import { ARCHETYPE_LABEL } from "@/lib/voices";

// /c/<art>/<line>: the page a shared card links to. Its og:image and twitter:image (the files beside
// it) are the wide card, so a post on X unfurls as the card itself. The page rings with the Chog, then
// shows the card, and the way in: "Get your Chog to call you".

type Params = Promise<{ art: string; line: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { art, line } = await params;
  const card = await readSharedCard(art, line);
  // A link the app could not have made answers 404 (bots read this before any of the page streams).
  if (!card) notFound();
  const title = `Chog #${card.profile.artId} called`;
  const description = `“${shortLine(card.line, 150)}” · ${ARCHETYPE_LABEL[card.profile.archetype]}. Get your Chog to call you.`;
  return {
    title: `${title} · Choglander`,
    description,
    openGraph: { type: "website", siteName: "Choglander", title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default function SharedCardPage({ params }: { params: Params }) {
  return (
    <main className="min-h-dvh w-full bg-[linear-gradient(180deg,#0f1230_0%,#272250_55%,#4b3566_100%)] px-4 pt-safe pb-safe text-[#fffdfb]">
      <div className="mx-auto flex w-full max-w-[720px] flex-col items-center py-8 sm:py-14">
        <Link href="/" className="inline-flex items-center gap-2.5 font-serif text-[20px] font-semibold tracking-tight">
          <PhoneMark />
          Choglander
        </Link>
        <Suspense fallback={<CardSkeleton />}>
          <SharedCard params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function SharedCard({ params }: { params: Params }) {
  const { art, line } = await params;
  const card = await readSharedCard(art, line);
  if (!card) notFound();
  const { profile } = card;
  const label = ARCHETYPE_LABEL[profile.archetype];
  const { artId, texture, side, traits, background, archetype } = profile;
  return (
    <>
      {/* Every line rings first: the friend answers and hears it, in the Chog's recorded voice or the
          device's, then reads it (the card, which prints the line, shows once the call has played). */}
      <AnswerCall
        chog={{ artId, texture, side, traits, background, archetype }}
        label={label}
        line={card.line}
        clip={card.clip}
        cardSrc={`/c/${artId}/${line}/opengraph-image`}
      />
      <Button asChild variant="light" size="lg" className="mt-9 w-full max-w-[340px]">
        {/* ?chog=<art> names this Chog to the app (screen-logic sharedChog): the visitor's first call comes from it.
            A plain link, so the app loads fresh: it reads the address once, and a client-side visit got there before the ?chog did. */}
        <a href={`/?chog=${artId}`}>Get your Chog to call you</a>
      </Button>
      <p className="mt-4 max-w-[34ch] text-center text-[14px] leading-snug text-white/65">
        Choglander: your Chog wakes you up, knows your day, and makes you laugh.
      </p>
    </>
  );
}

function CardSkeleton() {
  return (
    <>
      <div className="mt-9 h-4 w-40 rounded-full bg-white/10" />
      <div className="mt-5 aspect-[1200/630] w-full animate-pulse rounded-[18px] bg-white/[0.06]" />
    </>
  );
}

function PhoneMark() {
  return (
    <span className="grid h-8 w-8 place-items-center rounded-full bg-[#2fbf71]">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" />
      </svg>
    </span>
  );
}
