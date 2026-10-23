/** A soft hyphen: invisible, unless the line breaks there, when it shows as "-". */
export const SHY = "\u00AD";

/**
 * Where the sample week's titles break when their first word is too long for a narrow week column,
 * checked by hand against a dictionary. Chrome never hyphenates a capitalized word, and a title's
 * first word always is one, so CSS hyphens alone would split "Groceries" wherever its column runs
 * out of room. The words after it are lowercase and left to the browser's own hyphenation.
 */
const BREAKS: Record<string, string> = {
  groceries: "gro-cer-ies",
  standup: "stand-up",
  haircut: "hair-cut",
  dentist: "den-tist",
  dinner: "din-ner",
  bakery: "bak-ery",
};

/** Soft hyphens in the title's first word, at the breaks above, in whatever case it was typed. Nothing a reader sees changes. */
export function softHyphens(text: string): string {
  return text.replace(/^\p{L}+/u, (word) => {
    const parts = BREAKS[word.toLowerCase()]?.split("-");
    if (!parts) return word;
    let from = 0;
    return parts.map((part) => word.slice(from, (from += part.length))).join(SHY);
  });
}
