/**
 * Real-time sliding window throughput & ETA calculator.
 * Tracks bytes transferred over a moving time window to provide smooth, accurate
 * speed (bytes/sec) and remaining time (ETA in seconds) estimations.
 */
export class SpeedCalculator {
  private windowSeconds: number;
  private samples: Array<{ time: number; bytes: number }> = [];

  constructor(windowSeconds = 2.5) {
    this.windowSeconds = windowSeconds;
  }

  /**
   * Record current bytes transferred at a given timestamp (default: Date.now()).
   */
  public record(totalBytes: number, timestamp = Date.now()): void {
    this.samples.push({ time: timestamp, bytes: totalBytes });
    const cutoff = timestamp - this.windowSeconds * 1000;
    while (this.samples.length > 2 && this.samples[0].time < cutoff) {
      this.samples.shift();
    }
  }

  /**
   * Calculate current rolling speed in bytes per second.
   */
  public getSpeed(): number {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const dt = (last.time - first.time) / 1000;
    if (dt <= 0.05) return 0; // Avoid near-zero time deltas
    const db = last.bytes - first.bytes;
    return Math.max(0, db / dt);
  }

  /**
   * Calculate estimated time to completion in seconds based on current rolling throughput.
   * Returns null if speed is too low or undetermined ("Calculating...").
   */
  public getETA(totalBytes: number, currentBytes: number): number | null {
    const speed = this.getSpeed();
    if (speed <= 1024) return null; // Below 1 KB/s or initial ramp up
    const remaining = Math.max(0, totalBytes - currentBytes);
    if (remaining === 0) return 0;
    return Math.max(1, Math.round(remaining / speed));
  }

  /**
   * Reset tracking samples (e.g. on pause or new transfer).
   */
  public reset(): void {
    this.samples = [];
  }
}
