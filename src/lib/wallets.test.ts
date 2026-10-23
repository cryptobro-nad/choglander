import { describe, expect, it } from "vitest";
import { discoverWallets, isAddress, walletAppLinks } from "@/lib/wallets";

const provider = { request: async () => [] };

/** A window with only what discovery touches, and the wallets that answer its request. */
function fakeWindow(announce: Array<{ uuid?: string; name?: string; icon?: string; rdns?: string; provider?: unknown }>, ethereum?: unknown): Window {
  const target = new EventTarget();
  target.addEventListener("eip6963:requestProvider", () => {
    for (const { provider: given = provider, ...info } of announce) {
      target.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider: given }) }));
    }
  });
  return Object.assign(target, { setTimeout: (run: () => void) => setTimeout(run, 0), ethereum }) as unknown as Window;
}

describe("wallet discovery", () => {
  it("finds every announced wallet once, by name, with only data: icons kept", async () => {
    const found = await discoverWallets(
      fakeWindow([
        { uuid: "a", name: "Rabby Wallet", rdns: "io.rabby", icon: "data:image/svg+xml;base64,PHN2Zy8+" },
        { uuid: "b", name: "MetaMask", rdns: "io.metamask", icon: "https://evil.example/icon.png" },
        { uuid: "c", name: "Rabby again", rdns: "io.rabby" },
        { uuid: "d", name: "No provider", rdns: "x.none", provider: {} },
      ]),
    );
    expect(found.map((wallet) => [wallet.id, wallet.name, wallet.icon])).toEqual([
      ["io.rabby", "Rabby Wallet", "data:image/svg+xml;base64,PHN2Zy8+"],
      ["io.metamask", "MetaMask", ""],
    ]);
  });

  it("falls back to window.ethereum only when nothing announced", async () => {
    expect((await discoverWallets(fakeWindow([], provider))).map((wallet) => wallet.id)).toEqual(["injected"]);
    expect((await discoverWallets(fakeWindow([{ uuid: "a", name: "Phantom", rdns: "app.phantom" }], provider))).map((wallet) => wallet.id)).toEqual(["app.phantom"]);
    expect(await discoverWallets(fakeWindow([]))).toEqual([]);
  });
});

describe("check by address", () => {
  it("takes a whole 0x address only", () => {
    expect(isAddress("0x4B345C99FA4EC52227D41A4825EA671968D01CB2")).toBe(true);
    expect(isAddress(" 0x000000000000000000000000000000000000dEaD ")).toBe(true);
    expect(isAddress("0x4B345C99FA4EC52227D41A4825EA671968D01CB")).toBe(false);
    expect(isAddress("4B345C99FA4EC52227D41A4825EA671968D01CB2")).toBe(false);
    expect(isAddress("vitalik.eth")).toBe(false);
  });
});

describe("wallet app links", () => {
  it("open the live site's same page inside MetaMask and Coinbase Wallet", () => {
    expect(walletAppLinks("/judge")).toEqual({
      metamask: "https://metamask.app.link/dapp/choglander.vercel.app/judge",
      coinbase: "https://go.cb-w.com/dapp?cb_url=https%3A%2F%2Fchoglander.vercel.app%2Fjudge",
    });
    expect(walletAppLinks("/").metamask).toBe("https://metamask.app.link/dapp/choglander.vercel.app/");
  });
});
