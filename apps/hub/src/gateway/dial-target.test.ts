import { describe, expect, it, vi } from "vitest";
import { PINNED_SOURCE, pinnedResolver, resolveDialTarget } from "./dial-target.js";

const answers =
  (...addresses: string[]) =>
  async () =>
    addresses.map((address) => ({ address }));

describe("resolveDialTarget", () => {
  it("picks the first IPv4 answer", async () => {
    const lookup = answers("2001:db8::1", "93.184.216.34", "93.184.216.35");
    await expect(
      resolveDialTarget("ts.example.org", { lookup, allowPrivate: false }),
    ).resolves.toEqual({ address: "93.184.216.34" });
  });

  it("blocks when any answer is private, even if the first is public", async () => {
    const lookup = answers("93.184.216.34", "10.0.0.5");
    await expect(
      resolveDialTarget("ts.example.org", { lookup, allowPrivate: false }),
    ).rejects.toMatchObject({ message: "hub.connectBlockedTarget", name: "TargetBlocked" });
  });

  it("allows private answers when the operator says so", async () => {
    const lookup = answers("127.0.0.1");
    await expect(resolveDialTarget("localhost", { lookup, allowPrivate: true })).resolves.toEqual({
      address: "127.0.0.1",
    });
  });

  it("reports a lookup failure as dns-failed and keeps the cause", async () => {
    const cause = new Error("getaddrinfo ENOTFOUND nope");
    const lookup = async () => {
      throw cause;
    };
    await expect(resolveDialTarget("nope", { lookup, allowPrivate: false })).rejects.toMatchObject({
      message: "hub.connectDnsFailed",
      name: "DnsLookupFailed",
      cause,
    });
  });

  it("reports a name with no IPv4 answer as dns-failed", async () => {
    const lookup = answers("2001:db8::1");
    await expect(
      resolveDialTarget("v6only", { lookup, allowPrivate: false }),
    ).rejects.toMatchObject({ message: "hub.connectDnsFailed", name: "DnsLookupFailed" });
    await expect(
      resolveDialTarget("empty", { lookup: answers(), allowPrivate: false }),
    ).rejects.toMatchObject({ message: "hub.connectDnsFailed" });
  });

  it("resolves once: a rebinding name cannot change the dialled address", async () => {
    const lookup = vi
      .fn<() => Promise<Array<{ address: string }>>>()
      .mockResolvedValueOnce([{ address: "93.184.216.34" }])
      .mockResolvedValueOnce([{ address: "169.254.169.254" }]);
    const { address } = await resolveDialTarget("rebind.example", { lookup, allowPrivate: false });
    const resolver = pinnedResolver(address, 9987);
    const pinned = await resolver.resolve("rebind.example:9987");
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(pinned[0]?.addr).toBe("93.184.216.34:9987");
  });
});

describe("pinnedResolver", () => {
  it("answers with ip:port whatever it is asked and never resolves", async () => {
    const resolver = pinnedResolver("93.184.216.34", 9987);
    const first = await resolver.resolve("anything");
    const second = await resolver.resolve("something.else:1234");
    expect(first).toEqual([
      { addr: "93.184.216.34:9987", source: PINNED_SOURCE, expiry: new Date(0) },
    ]);
    expect(second).toEqual(first);
  });

  it("brackets an IPv6 address", async () => {
    const [pinned] = await pinnedResolver("2001:db8::1", 9987).resolve("x");
    expect(pinned?.addr).toBe("[2001:db8::1]:9987");
  });
});
