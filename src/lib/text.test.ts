import { describe, expect, it } from "vitest";
import { capEdit, capUnits } from "@/lib/text";

const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";

describe("capEdit", () => {
  it("lets any edit under the limit through as typed", () => {
    expect(capEdit("abc", "abXc", 3, 10)).toEqual({ value: "abXc", caret: 3 });
  });

  it("refuses a letter typed in the middle of a full title, keeping its end and the caret", () => {
    const full = "0123456789" + "b".repeat(49) + "Z";
    const typed = full.slice(0, 10) + "X" + full.slice(10);
    expect(capEdit(full, typed, 11, 60)).toEqual({ value: full, caret: 10 });
  });

  it("keeps the start of a paste that only partly fits, and the text after it", () => {
    const before = "c".repeat(20) + "d".repeat(35);
    const after = "c".repeat(20) + "XYZWVUT" + "d".repeat(35);
    expect(capEdit(before, after, 27, 60)).toEqual({ value: "c".repeat(20) + "XYZWV" + "d".repeat(35), caret: 25 });
  });

  it("drops an emoji at the edge whole, wherever it lands", () => {
    expect(capEdit("a".repeat(57), "a".repeat(57) + family, 65, 60)).toEqual({ value: "a".repeat(57), caret: 57 });
    expect(capEdit("a".repeat(52), "a".repeat(52) + family, 60, 60)).toEqual({ value: "a".repeat(52) + family, caret: 60 });
    const before = "x".repeat(5) + "y".repeat(52);
    expect(capEdit(before, "x".repeat(5) + family + "y".repeat(52), 13, 60)).toEqual({ value: before, caret: 5 });
  });

  it("never splits an emoji that shares its first half with the one replaced", () => {
    // U+1F600 and U+1F601 share a high surrogate: a selected one replaced by the other at the limit.
    const before = "a".repeat(57) + "\u{1F600}" + "b";
    const after = "a".repeat(57) + "\u{1F601}\u{1F602}" + "b";
    expect(capEdit(before, after, 61, 60)).toEqual({ value: "a".repeat(57) + "\u{1F601}" + "b", caret: 59 });
  });

  it("caps an edit it cannot follow from the end, as capUnits does", () => {
    expect(capEdit("abc", "zzzzzz", 2, 4)).toEqual({ value: capUnits("zzzzzz", 4), caret: 2 });
  });
});
