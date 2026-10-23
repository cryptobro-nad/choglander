import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { SHY, softHyphens } from "@/lib/hyphens";
import { seedEvents } from "@/lib/persist";

const shown = (text: string) => softHyphens(text).replaceAll(SHY, "·");

describe("softHyphens", () => {
  it("breaks the sample week's long words where a dictionary does", () => {
    expect(shown("Groceries")).toBe("Gro·cer·ies");
    expect(shown("Standup")).toBe("Stand·up");
    expect(shown("Haircut")).toBe("Hair·cut");
    expect(shown("Dentist")).toBe("Den·tist");
    expect(shown("Dinner party")).toBe("Din·ner party");
    expect(shown("Bakery run")).toBe("Bak·ery run");
    // A later word is lowercase and the browser's to hyphenate, so it is never split just to fill a line.
    expect(shown("Design review")).toBe("Design review");
    expect(shown("Team standup")).toBe("Team standup");
  });

  it("keeps the case the word was typed in", () => {
    expect(shown("STANDUP")).toBe("STAND·UP");
  });

  it("leaves every other word to the browser, never guessing a break", () => {
    for (const title of ["Lovely", "Laughing", "Teacup", "Brunch", "Lunch", "Drinks", "Standups", "Redesign", "Café meetup"]) {
      expect(softHyphens(title)).toBe(title);
    }
  });

  it("changes nothing a reader sees, in any sample block", () => {
    for (const event of seedEvents(new Date(2026, 9, 22, 8, 0))) {
      expect(softHyphens(event.title).replaceAll(SHY, "")).toBe(event.title);
    }
  });

  it("is a soft hyphen, written as an escape in the source", () => {
    expect(SHY).toBe(String.fromCharCode(0xad));
    const source = fs.readFileSync(new URL("./hyphens.ts", import.meta.url), "utf8");
    expect(source).toContain('"\\u00AD"');
    expect(source).not.toContain(String.fromCharCode(0xad));
  });
});
