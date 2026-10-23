import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHOG_CONTRACT, CHOG_RPC, IPFS_GATEWAYS, ownerOfData, parseOwnerResult, rpcOwnerOf, sameAddress, tokenFromArt } from "@/lib/ids";
import { defaultRelationship, metaFromProfile, parseChogInput, profileFromMeta, relationshipFor } from "@/lib/chog";

const HOLDER = "0xd722dd9ce0087e12f529dc37ddbad40a24059bec";
const WORD = `0x000000000000000000000000${HOLDER.slice(2)}`;

function rpc(body: unknown, status = 200) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    void url;
    void init;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
}

describe("ownerOf on Monad", () => {
  it("encodes the call for the token behind art #375", () => {
    expect(tokenFromArt(375)).toBe(883);
    expect(ownerOfData(883)).toBe(`0x6352211e${"0".repeat(61)}373`);
  });

  it("reads an owner, and treats an empty answer as 'could not check'", () => {
    expect(parseOwnerResult(WORD)).toBe(HOLDER);
    expect(parseOwnerResult(WORD.toUpperCase().replace("0X", "0x"))).toBe(HOLDER);
    expect(parseOwnerResult("0x")).toBeNull();
    expect(parseOwnerResult("0x1234")).toBeNull();
    expect(parseOwnerResult(`0x${"0".repeat(64)}`)).toBeNull();
    expect(parseOwnerResult(undefined)).toBeNull();
    expect(sameAddress(HOLDER.toUpperCase().replace("0X", "0x"), HOLDER)).toBe(true);
    expect(sameAddress(null, HOLDER)).toBe(false);
  });

  it("asks the Monad RPC, not the wallet's chain", async () => {
    const fetchImpl = rpc({ jsonrpc: "2.0", id: 1, result: WORD });
    await expect(rpcOwnerOf(883, { fetchImpl })).resolves.toBe(HOLDER);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(CHOG_RPC);
    const body = JSON.parse(String(init?.body));
    expect(body.method).toBe("eth_call");
    expect(body.params[0]).toEqual({ to: CHOG_CONTRACT, data: ownerOfData(883) });
  });

  it("fails loudly on a revert, an HTTP error or a bad token", async () => {
    await expect(rpcOwnerOf(883, { fetchImpl: rpc({ error: { code: 3, message: "execution reverted" } }) })).rejects.toThrow("execution reverted");
    await expect(rpcOwnerOf(883, { fetchImpl: rpc({}, 503) })).rejects.toThrow("503");
    await expect(rpcOwnerOf(5000, { fetchImpl: rpc({ result: WORD }) })).rejects.toThrow();
  });
});

describe("GET /api/owner", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the owner, and serves a repeat from its short cache", async () => {
    const fetchImpl = rpc({ result: WORD });
    vi.stubGlobal("fetch", fetchImpl);
    const { GET } = await import("@/app/api/owner/route");
    const first = await GET(new Request("http://localhost/api/owner?token=883"));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ owner: HOLDER });
    const second = await GET(new Request("http://localhost/api/owner?token=883"));
    expect((await second.json()).owner).toBe(HOLDER);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a bad token and reports a chain it could not read", async () => {
    vi.stubGlobal("fetch", rpc({ error: { message: "execution reverted" } }));
    const { GET } = await import("@/app/api/owner/route");
    expect((await GET(new Request("http://localhost/api/owner?token=abc"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/owner?token=0"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/owner?token=1970"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/owner"))).status).toBe(400);
    const failed = await GET(new Request("http://localhost/api/owner?token=12"));
    expect(failed.status).toBe(502);
    expect((await failed.json()).owner).toBeNull();
  });
});

describe("who you are to a Chog", () => {
  it("lends the demo Chogs, and treats any other as a stranger until a wallet proves otherwise", () => {
    expect(defaultRelationship(375)).toBe("lent");
    expect(defaultRelationship(1000)).toBe("stranger");
    expect(relationshipFor(1000, "lent")).toBe("stranger");
    expect(relationshipFor(1000, "owner")).toBe("owner");
    expect(relationshipFor(642, undefined)).toBe("lent");
  });

  it("reads a Chog # or an explicit token id", () => {
    expect(parseChogInput("375")).toBe(375);
    expect(parseChogInput(" #642 ")).toBe(642);
    expect(parseChogInput("t883")).toBe(375);
    expect(() => parseChogInput("2000")).toThrow();
    expect(parseChogInput("t1969")).toBe(1461);
    expect(() => parseChogInput("t0")).toThrow();
    expect(() => parseChogInput("t1970")).toThrow();
    expect(() => parseChogInput("chog")).toThrow();
    expect(() => parseChogInput("")).toThrow();
  });

  it("rebuilds the same profile from cached metadata", () => {
    const meta = {
      name: "CHOG #1000",
      image: "ipfs://bafybeihau2egcccbdxymeckmmbrqytbfor5gkt3en6d5fsbueymdbq7g6e/1000.webp",
      attributes: [
        { trait_type: "Background", value: "Mint" },
        { trait_type: "Side", value: "Right" },
        { trait_type: "Skin", value: "Yellow" },
        { trait_type: "Body", value: "White tuxedo" },
        { trait_type: "Eyes", value: "Happy" },
      ],
    };
    const profile = profileFromMeta(1000, meta);
    const again = profileFromMeta(1000, metaFromProfile(profile));
    expect(again).toEqual(profile);
    expect(again.tokenId).toBe(tokenFromArt(1000));
  });
});

describe("Chog metadata from IPFS", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const meta = { name: "CHOG #1000", image: "ipfs://cid/1000.webp", attributes: [{ trait_type: "Side", value: "Left" }] };

  it("falls through gateways and retries once after a round of rate limits", async () => {
    const { fetchMeta } = await import("@/lib/chog");
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return calls <= IPFS_GATEWAYS.length + 1 ? new Response("slow down", { status: 429 }) : new Response(JSON.stringify(meta), { status: 200 });
      }),
    );
    await expect(fetchMeta(1000, { retryDelayMs: 1 })).resolves.toEqual(meta);
    expect(calls).toBe(IPFS_GATEWAYS.length + 2);
  });

  it("gives up after two rounds, and does not retry a plain miss", async () => {
    const { fetchMeta } = await import("@/lib/chog");
    const limited = vi.fn(async () => new Response("", { status: 429 }));
    vi.stubGlobal("fetch", limited);
    await expect(fetchMeta(1000, { retryDelayMs: 1 })).rejects.toThrow();
    expect(limited).toHaveBeenCalledTimes(IPFS_GATEWAYS.length * 2);
    const missing = vi.fn(async () => new Response("", { status: 404 }));
    vi.stubGlobal("fetch", missing);
    await expect(fetchMeta(1000, { retryDelayMs: 1 })).rejects.toThrow();
    expect(missing).toHaveBeenCalledTimes(IPFS_GATEWAYS.length);
  });
});
