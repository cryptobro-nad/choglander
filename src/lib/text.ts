// Caps on what a person types. They count characters as people see them (graphemes), so an emoji,
// a flag or an accented letter is never cut in half and left behind as a broken glyph.

function graphemes(text: string): string[] {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (!Segmenter) return Array.from(text);
  return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
}

/** At most `max` characters as people see them: whatever is cut, an emoji or an accent stays whole. */
export function capText(text: string, max: number): string {
  const parts = graphemes(text);
  return parts.length <= max ? text : parts.slice(0, max).join("");
}

/**
 * At most `max` UTF-16 units (what an input's maxLength counts), cut only between characters, so a
 * pasted emoji at the edge is dropped whole rather than split.
 */
export function capUnits(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = "";
  for (const part of graphemes(text)) {
    if (out.length + part.length > max) break;
    out += part;
  }
  return out;
}

/**
 * One edit to a field of at most `max` UTF-16 units, cut the way an input's maxLength cuts it: what
 * was just typed or pasted loses its end, and the text after the caret stays. Unlike maxLength it
 * never keeps half an emoji. `caret` is where the caret sat after the edit; the result says where it
 * goes now.
 */
export function capEdit(before: string, after: string, caret: number, max: number): { value: string; caret: number } {
  if (after.length <= max) return { value: after, caret };
  const tail = after.slice(caret);
  if (!before.endsWith(tail)) {
    const value = capUnits(after, max);
    return { value, caret: Math.min(caret, value.length) };
  }
  // Where the new text starts: as far as it matches what was there, and never into the kept tail.
  const limit = Math.min(caret, before.length - tail.length);
  let shared = 0;
  while (shared < limit && before[shared] === after[shared]) shared++;
  // Back to the start of the character it falls in, so an emoji is kept or dropped whole.
  let start = 0;
  for (const part of graphemes(after.slice(0, caret))) {
    if (start + part.length > shared) break;
    start += part.length;
  }
  const room = max - start - tail.length;
  let kept = "";
  for (const part of graphemes(after.slice(start, caret))) {
    if (kept.length + part.length > room) break;
    kept += part;
  }
  // Nothing new fits, and keeping a whole character would cost some of what was there: no change.
  if (start + kept.length < shared) return { value: before, caret: shared };
  return { value: after.slice(0, start) + kept + tail, caret: start + kept.length };
}
