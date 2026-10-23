/**
 * Finding the wallets in this browser. EIP-6963 lets every installed extension announce itself
 * (Rabby, Phantom, Coinbase, MetaMask), so two of them no longer fight over window.ethereum; an older
 * wallet that only sets window.ethereum is still found. No keys and no accounts: with nothing here, a
 * phone can open the page inside a wallet's own browser, and anyone can check an address by hand.
 */

export type Wallet = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

/** A wallet found in this browser: `icon` is a data: image the wallet gave, or "" when it gave none. */
export type FoundWallet = { id: string; name: string; icon: string; provider: Wallet };

/** The canonical site, for the links that open it inside a wallet app (a local copy can't be reached from there). */
export const WALLET_SITE = "choglander.vercel.app";

type Announcement = { info?: { uuid?: unknown; name?: unknown; icon?: unknown; rdns?: unknown }; provider?: unknown };

function isWallet(value: unknown): value is Wallet {
  return typeof value === "object" && value !== null && typeof (value as Wallet).request === "function";
}

/** Only a data: image is shown, as EIP-6963 asks, so a wallet's icon can't load anything from elsewhere. */
function safeIcon(icon: unknown): string {
  return typeof icon === "string" && /^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/i.test(icon) ? icon : "";
}

/**
 * Asks every wallet extension to announce itself and waits `waitMs` for them (they answer at once,
 * the wait is for a slow one). One entry per wallet; window.ethereum only when nobody announced.
 */
export function discoverWallets(win: Window = window, waitMs = 250): Promise<FoundWallet[]> {
  return new Promise((resolve) => {
    const found = new Map<string, FoundWallet>();
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Announcement>).detail;
      const info = detail?.info;
      if (!info || !isWallet(detail.provider)) return;
      const id = typeof info.rdns === "string" && info.rdns ? info.rdns : typeof info.uuid === "string" ? info.uuid : "";
      const name = typeof info.name === "string" ? info.name.trim().slice(0, 40) : "";
      if (!id || !name || found.has(id)) return;
      found.set(id, { id, name, icon: safeIcon(info.icon), provider: detail.provider });
    };
    win.addEventListener("eip6963:announceProvider", onAnnounce);
    win.dispatchEvent(new Event("eip6963:requestProvider"));
    win.setTimeout(() => {
      win.removeEventListener("eip6963:announceProvider", onAnnounce);
      const wallets = [...found.values()];
      const injected = (win as unknown as { ethereum?: unknown }).ethereum;
      if (!wallets.length && isWallet(injected)) wallets.push({ id: "injected", name: "Browser wallet", icon: "", provider: injected });
      resolve(wallets);
    }, waitMs);
  });
}

/** A whole 0x address: 40 hex characters, any case (a checksum isn't needed to read ownerOf). */
export function isAddress(text: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(text.trim());
}

/** Links that open this page inside MetaMask's and Coinbase Wallet's own browsers, on the live site. */
export function walletAppLinks(path: string): { metamask: string; coinbase: string } {
  const at = path.startsWith("/") ? path : `/${path}`;
  return {
    metamask: `https://metamask.app.link/dapp/${WALLET_SITE}${at}`,
    coinbase: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(`https://${WALLET_SITE}${at}`)}`,
  };
}
