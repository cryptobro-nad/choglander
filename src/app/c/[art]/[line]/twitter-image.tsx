import { cardImage } from "@/app/c/card";

// X reads twitter:image first; it is the same wide card as the og:image beside it.

export const alt = "A Choglander share card: the Chog in its arch and the line it said on the call";
export const size = { width: 1200, height: 630 };
export const contentType = "image/jpeg";

export default async function Image({ params }: { params: Promise<{ art: string; line: string }> }) {
  const { art, line } = await params;
  return cardImage(art, line);
}
