import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Sky, skyTop } from "@/components/app/Sky";

describe("skyTop", () => {
  it("gives the browser toolbar the colour at the top of each sky", () => {
    expect(skyTop("morning")).toBe("#fff6ea");
    expect(skyTop("dawn")).toBe("#ffd0b4");
    expect(skyTop("dusk")).toBe("#ffb7a8");
    expect(skyTop("night")).toBe("#070814");
  });

  it("follows the deeper call sky while a call rings", () => {
    expect(skyTop("night", true)).toBe("#05060f");
    expect(skyTop("dusk", true)).toBe("#6b3d6d");
  });
});

describe("Sky", () => {
  const sky = (props: Parameters<typeof Sky>[0]) => renderToStaticMarkup(createElement(Sky, props));

  it("keeps the sun glow and clouds out from behind a call's white header at dusk, over a dark hill", () => {
    const call = sky({ phase: "dusk", dramatic: true });
    expect(call).not.toContain("cloud");
    expect(call).not.toContain("rgba(255,236,210");
    expect(call).toContain("#2f2b62");
    const home = sky({ phase: "dusk" });
    expect(home).toContain("cloud");
    expect(home).toContain("rgba(255,236,210");
    expect(home).toContain("#ddd3f2");
  });

  it("leaves the daytime call skies their sun and clouds", () => {
    const call = sky({ phase: "day", dramatic: true });
    expect(call).toContain("cloud");
    expect(call).toContain("rgba(255,236,210");
  });

  it("thins fog on a twilight call, so the white header still reads", () => {
    expect(sky({ phase: "dusk", dramatic: true, weather: "fog" })).toContain("bg-white/[0.06]");
    expect(sky({ phase: "dusk", weather: "fog" })).toContain("bg-white/25");
  });

  it("sets setup's moon while the Chog's speech bubble is up", () => {
    expect(sky({ phase: "night", moon: "low" })).toContain("[body:has([data-bubble])_&amp;]:opacity-0");
    expect(sky({ phase: "night" })).not.toContain("data-bubble");
  });
});
