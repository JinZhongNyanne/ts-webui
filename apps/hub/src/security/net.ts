/**
 * Address classification for the outbound guard.
 *
 * The hub dials a UDP address chosen by the browser, so without a check an
 * open hub is a probe into whatever the host can reach — the loopback
 * interface, the docker network, a cloud metadata service. Production
 * therefore refuses targets that resolve to a private range unless the
 * operator allows them explicitly.
 */
import { isIP } from "node:net";

/** True for loopback, link-local, private, CGNAT, multicast and unspecified addresses. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateV4(address);
  if (family === 6) return isPrivateV6(address);
  return false;
}

function isPrivateV4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true; // this network, private, loopback
  if (a === 169 && b === 254) return true; // link-local (cloud metadata lives here)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast and reserved
  return false;
}

function isPrivateV6(address: string): boolean {
  const addr = address.toLowerCase().split("%")[0]!; // drop any zone index
  // IPv4-mapped (::ffff:10.0.0.1) and IPv4-compatible forms.
  const mapped = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped) return isPrivateV4(mapped[1]!);
  if (addr === "::" || addr === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(addr)) return true; // unique local fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(addr)) return true; // link-local fe80::/10
  if (/^ff[0-9a-f]{2}:/.test(addr)) return true; // multicast
  return false;
}
