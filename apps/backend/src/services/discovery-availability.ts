import type { DiscoveryResult } from "@music-os/core";

/**
 * Orders discovery results by how likely the remote peer is to start sending
 * soon: free upload slots first, then shorter remote queues, then faster
 * reported upload speeds. Locked results are not filtered here; callers decide
 * which results are eligible before ranking.
 */
export function rankDiscoveryResultsByAvailability(results: DiscoveryResult[]): DiscoveryResult[] {
  return [...results].sort(compareDiscoveryResultAvailability);
}

export function compareDiscoveryResultAvailability(a: DiscoveryResult, b: DiscoveryResult): number {
  const slotDelta = freeSlotRank(a) - freeSlotRank(b);
  if (slotDelta !== 0) {
    return slotDelta;
  }
  const queueDelta = queueRank(a) - queueRank(b);
  if (queueDelta !== 0) {
    return queueDelta;
  }
  return uploadSpeed(b) - uploadSpeed(a);
}

function freeSlotRank(result: DiscoveryResult): number {
  if (result.hasFreeUploadSlot === true) {
    return 0;
  }
  if (result.hasFreeUploadSlot == null) {
    return 1;
  }
  return 2;
}

function queueRank(result: DiscoveryResult): number {
  return result.queueLength ?? 0;
}

function uploadSpeed(result: DiscoveryResult): number {
  return result.uploadSpeedBytesPerSecond ?? 0;
}
