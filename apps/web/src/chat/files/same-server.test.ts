import { describe, expect, it } from "vitest";
import { linkIsHere } from "./same-server";

const here = [{ host: "ts.example.org", port: 9987 }];

describe("linkIsHere", () => {
  it("takes a link to the same name and port", () => {
    expect(linkIsHere({ host: "ts.example.org", port: 9987 }, here)).toBe(true);
    expect(linkIsHere({ host: "TS.Example.org.", port: 9987 }, here)).toBe(true);
    expect(linkIsHere({ host: "ts.example.org" }, here)).toBe(true);
  });

  it("refuses another name, and the same name on another virtual server", () => {
    expect(linkIsHere({ host: "other.example.org", port: 9987 }, here)).toBe(false);
    expect(linkIsHere({ host: "ts.example.org", port: 9988 }, here)).toBe(false);
  });

  it("gives the link the benefit of the doubt when it cannot be compared", () => {
    // Nothing known about our own server (a hub with a fixed server may say nothing).
    expect(linkIsHere({ host: "other.example.org" }, [])).toBe(true);
    // An IP against a name: the browser cannot resolve either.
    expect(linkIsHere({ host: "10.0.0.5", port: 9987 }, here)).toBe(true);
    expect(linkIsHere({ host: "ts.example.org" }, [{ host: "10.0.0.5" }])).toBe(true);
    // "localhost" says where the sender was, not which server it is.
    expect(linkIsHere({ host: "localhost", port: 9987 }, here)).toBe(true);
    expect(linkIsHere({ host: "", port: 9987 }, here)).toBe(true);
  });

  it("compares two addresses of the same kind", () => {
    const ip = [{ host: "10.0.0.5", port: 9987 }];
    expect(linkIsHere({ host: "10.0.0.5", port: 9987 }, ip)).toBe(true);
    expect(linkIsHere({ host: "10.0.0.6", port: 9987 }, ip)).toBe(false);
  });

  it("takes a link that matches any of the addresses we know", () => {
    const both = [{ host: "ts.example.org", port: 9987 }, { host: "web.example.org" }];
    expect(linkIsHere({ host: "web.example.org", port: 9987 }, both)).toBe(true);
    expect(linkIsHere({ host: "nope.example.org", port: 9987 }, both)).toBe(false);
  });
});
