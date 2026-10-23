import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Picker } from "@/components/app/Picker";

const noop = () => undefined;

describe("Picker", () => {
  it("draws a light focus ring on the night sky, where indigo would be under 3:1", () => {
    const night = renderToStaticMarkup(<Picker selected={null} onSelect={noop} night />);
    expect(night).toContain("focus-visible:outline-[#f6f3ff]");
    expect(night).not.toContain("focus-visible:outline-[#4a55c9]");
  });

  it("keeps the indigo ring on a light page", () => {
    const day = renderToStaticMarkup(<Picker selected={null} onSelect={noop} />);
    expect(day).toContain("focus-visible:outline-[#4a55c9]");
    expect(day).not.toContain("focus-visible:outline-[#f6f3ff]");
  });
});
