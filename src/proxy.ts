import { NextResponse, type NextRequest } from "next/server";
import { readSharedCard } from "@/app/c/share";

// A share link the app could not have made (/c/<art>/<line>, see shareGuard) answers a real 404. The
// page can't send one itself: with Cache Components its shell is prerendered, and the status goes out
// with the shell before the link is read (bots, which skip the shell, already got the 404). So the
// link is read here first, and a refused one gets the not-found page from an address nothing serves.
// The Android export has no server, so it leaves this file out (scripts/export-android.mjs).

export async function proxy(request: NextRequest) {
  const [, , art = "", line = ""] = request.nextUrl.pathname.split("/");
  if (await readSharedCard(art, line)) return NextResponse.next();
  return NextResponse.rewrite(new URL("/c/wrong-number", request.url));
}

export const config = { matcher: "/c/:art/:line" };
