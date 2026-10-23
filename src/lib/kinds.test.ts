import { describe, expect, it } from "vitest";
import { bodyKind, eventKind, eyesKind, headKind } from "@/lib/kinds";
import { seedEvents } from "@/lib/persist";
import { traitCatalog } from "@/lib/traits";

describe("event kinds", () => {
  it("knows every title in the sample week", () => {
    const kinds = Object.fromEntries(seedEvents(new Date(2026, 9, 19, 9, 0)).map((event) => [event.title, eventKind(event.title)]));
    expect(kinds).toMatchObject({
      Standup: "meeting",
      "Deep work": "focus",
      Lunch: "food",
      Gym: "workout",
      "Design review": "meeting",
      "Book club": "social",
      "One-on-one": "meeting",
      Dinner: "food",
      "Bakery run": "errand",
      "Bin day": "errand",
    });
    expect(Object.values(kinds)).not.toContain("other");
  });

  it("reads the titles people actually type", () => {
    const cases: Array<[string, string]> = [
      ["Dentist", "health"],
      ["Dr Patel 3pm", "health"],
      ["Pitch the investors", "big"],
      ["Job interview", "big"],
      ["Team lunch", "food"],
      ["Coffee with Sam", "food"],
      ["Call mom", "family"],
      ["School run", "family"],
      ["Morning run", "workout"],
      ["Yoga", "workout"],
      ["Groceries", "errand"],
      ["Haircut", "errand"],
      ["Drinks with Jo", "social"],
      ["Flight to Lisbon", "travel"],
      ["Nap", "rest"],
      ["Finish the essay", "focus"],
      ["Quarterly planning", "meeting"],
      ["Brunch", "food"],
      ["Gymnastics with Ana", "other"],
      ["Zxqv", "other"],
      ["", "other"],
    ];
    for (const [title, kind] of cases) expect(eventKind(title), title).toBe(kind);
  });
});

describe("trait kinds", () => {
  it("sorts every hat, outfit and pair of eyes in the collection", () => {
    const labels = traitCatalog().labels;
    const heads = Object.values(labels.Head ?? {});
    const bodies = Object.values(labels.Body ?? {});
    const eyes = Object.values(labels.Eyes ?? {});
    expect(heads.map(headKind)).not.toContain("none");
    expect(bodies.map(bodyKind)).not.toContain("none");
    // Each kind is real: something in the collection wears it.
    expect(new Set(heads.map(headKind))).toEqual(new Set(["beanie", "cap", "crown", "horns", "helmet", "hair", "band", "hat", "odd"]));
    expect(new Set(bodies.map(bodyKind))).toEqual(new Set(["suit", "costume", "hoodie", "tee", "robe", "jacket", "armor"]));
    expect(new Set(eyes.map(eyesKind))).toEqual(new Set(["glasses", "smiling", "sleepy", "wide", "narrow"]));
  });

  it("puts the demo Chogs' things where a joke would", () => {
    expect(headKind("Wizard Beanie")).toBe("beanie");
    expect(headKind("Crown")).toBe("crown");
    expect(headKind("Devil Horn")).toBe("horns");
    expect(headKind("Gold Thorn")).toBe("crown");
    expect(headKind("Wizard Hat")).toBe("hat");
    expect(headKind("Taped Banana")).toBe("odd");
    expect(headKind(null)).toBe("none");
    expect(bodyKind("Toad Green Suit")).toBe("costume");
    expect(bodyKind("Cream Tuxedo")).toBe("suit");
    expect(bodyKind("Blue 143 Jersey")).toBe("tee");
    expect(bodyKind("Golden Armor")).toBe("armor");
    expect(eyesKind("3D Glass")).toBe("glasses");
    expect(eyesKind("Closed Eye Crying")).toBe("sleepy");
    expect(eyesKind("Smirk")).toBe("narrow");
  });

  it("files each eye trait by how its art is drawn", () => {
    // Drawn shut with a smile: never "poke the big eyes".
    for (const eyes of ["Happy", "Mixed Happy", "Green Happy", "XD"]) expect(eyesKind(eyes), eyes).toBe("smiling");
    // Wide open, crying or not: never "half closed".
    for (const eyes of ["Round", "Round Eye", "Round Crying", "Round Tear", "Teary", "Heart", "Frog", "Retard", "Worried"]) expect(eyesKind(eyes), eyes).toBe("wide");
    for (const eyes of ["Tired", "Dead", "Closed Eye Crying"]) expect(eyesKind(eyes), eyes).toBe("sleepy");
    for (const eyes of ["Chog Viper", "MOG", "Thug", "Classic VR", "fire laser"]) expect(eyesKind(eyes), eyes).toBe("glasses");
    for (const eyes of ["Side Eye", "Normal Eye", "Angry", "Flat", "Base", "Vertical", "Clown Eye"]) expect(eyesKind(eyes), eyes).toBe("narrow");
  });
});
