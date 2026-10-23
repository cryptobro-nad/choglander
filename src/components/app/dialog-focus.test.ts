import { describe, expect, it } from "vitest";
import { wrapFocus } from "@/components/app/dialog-focus";

describe("wrapFocus", () => {
  const items = ["close", "name", "keep"];

  it("wraps Tab from the last control to the first, and Shift+Tab from the first to the last", () => {
    expect(wrapFocus(items, "keep", false)).toBe("close");
    expect(wrapFocus(items, "close", true)).toBe("keep");
  });

  it("leaves the browser to move focus between controls in the middle", () => {
    expect(wrapFocus(items, "close", false)).toBeNull();
    expect(wrapFocus(items, "keep", true)).toBeNull();
  });

  it("brings focus that slipped outside back in", () => {
    expect(wrapFocus(items, null, false)).toBe("close");
    expect(wrapFocus(items, "home screen", true)).toBe("keep");
    expect(wrapFocus([], null, false)).toBeNull();
  });
});
