/** Number formatting for the connection info (ConnectionInfo.vue). */

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const STEP = 1024;

export function formatBytes(n: number): string {
  let v = Number.isFinite(n) && n > 0 ? n : 0;
  let i = 0;
  while (v >= STEP && i < UNITS.length - 1) {
    v /= STEP;
    i++;
  }
  return `${i ? v.toFixed(1) : Math.round(v)} ${UNITS[i]}`;
}

export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** TeamSpeak reports packet loss as a 0–1 ratio. */
export function formatLoss(ratio: number): string {
  const v = Number.isFinite(ratio) && ratio > 0 ? ratio : 0;
  return `${(v * 100).toFixed(2)} %`;
}
