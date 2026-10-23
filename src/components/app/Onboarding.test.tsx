import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Onboarding } from "@/components/app/Onboarding";

const noop = () => undefined;
const alarm = { enabled: true, hour: 7, minute: 30, days: [1, 2, 3, 4, 5] };

const render = (mode: "first" | "switch", shared: number | null = null) =>
  renderToStaticMarkup(<Onboarding phase="day" weather={null} mode={mode} deviceId="test" mute={false} alarm={alarm} shared={shared} onDone={noop} />);

describe("the front door", () => {
  it("opens on the welcome card, with no call before setup", () => {
    const html = render("first");
    expect(html).toContain("A call, not a feed.");
    expect(html).toContain("Get started");
    expect(html).toContain('aria-label="Step 1 of 7"');
    expect(html).not.toContain("Incoming call");
    expect(html).not.toContain('aria-label="Answer"');
    expect(html).not.toContain("call-pulse");
  });

  it("names the Chog a shared link came from", () => {
    expect(render("first", 1150)).toContain("Chog #1150");
  });

  it("goes straight to the pick when switching Chog", () => {
    const html = render("switch");
    expect(html).toContain("Who wakes you");
    expect(html).not.toContain("Get started");
  });
});
