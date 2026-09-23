/**
 * The web app manifest's install criteria, as a check we can run in a test.
 *
 * A browser never complains about an incomplete manifest: it simply stops
 * offering to install the app, and the only way to notice is to open the
 * developer tools on a production build over https. So the rules a browser
 * applies silently are spelled out here and asserted against the manifest
 * that actually ships.
 */

/** The PNG sizes Chrome and Android need before they will offer an install. */
export const REQUIRED_ICON_SIZES = [192, 512] as const;

/** Display modes that launch without browser chrome; `browser` does not. */
export const STANDALONE_DISPLAYS = ["standalone", "fullscreen", "minimal-ui"] as const;

/** Fields a manifest cannot be installed without, or which we always want set. */
const REQUIRED_FIELDS = [
  "name",
  "short_name",
  "start_url",
  "scope",
  "display",
  "theme_color",
  "background_color",
  "icons",
] as const;

/** Only ever used to resolve the relative URLs against each other. */
const RESOLUTION_BASE = "https://manifest.invalid";

interface ManifestIcon {
  readonly src?: unknown;
  readonly sizes?: unknown;
  readonly type?: unknown;
  readonly purpose?: unknown;
}

function iconsOf(manifest: Record<string, unknown>): readonly ManifestIcon[] {
  const icons = manifest["icons"];
  return Array.isArray(icons) ? (icons as readonly ManifestIcon[]) : [];
}

/** `sizes` is a space-separated list, and `any` (an SVG) counts for no size. */
function hasSize(icon: ManifestIcon, size: number): boolean {
  return String(icon.sizes ?? "")
    .split(/\s+/)
    .includes(`${size}x${size}`);
}

/** `purpose` is a space-separated list too, defaulting to `any`. */
function hasPurpose(icon: ManifestIcon, purpose: string): boolean {
  const purposes = String(icon.purpose ?? "any").split(/\s+/);
  return purposes.includes(purpose);
}

function startUrlIsInScope(manifest: Record<string, unknown>): boolean {
  try {
    const scope = new URL(String(manifest["scope"] ?? "/"), RESOLUTION_BASE);
    const start = new URL(String(manifest["start_url"] ?? "/"), scope);
    return start.href.startsWith(scope.href);
  } catch {
    // An unparseable URL is a problem in its own right, reported by the caller.
    return false;
  }
}

/**
 * Everything standing between this manifest and an install prompt.
 * An empty list means the manifest side of the criteria is met — the browser
 * still requires https, a registered service worker with a fetch handler and
 * icons that really resolve.
 */
export function installabilityProblems(manifest: unknown): readonly string[] {
  if (typeof manifest !== "object" || manifest === null) return ["not an object"];
  const fields = manifest as Record<string, unknown>;
  const problems: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    if (fields[field] === undefined || fields[field] === null) problems.push(`${field} is missing`);
  }

  const display = String(fields["display"] ?? "");
  if (!STANDALONE_DISPLAYS.includes(display as (typeof STANDALONE_DISPLAYS)[number])) {
    problems.push(`display must be one of ${STANDALONE_DISPLAYS.join(", ")}`);
  }

  const icons = iconsOf(fields);
  for (const size of REQUIRED_ICON_SIZES) {
    const found = icons.some(
      (icon) => hasSize(icon, size) && String(icon.type ?? "") === "image/png",
    );
    if (!found) problems.push(`no ${size}x${size} PNG icon`);
  }
  // Without one, Android crops the square icon into its own shape and clips
  // whatever sits near the edges.
  if (!icons.some((icon) => hasPurpose(icon, "maskable"))) problems.push("no maskable icon");

  if (!startUrlIsInScope(fields)) problems.push("start_url is outside scope");

  return problems;
}
