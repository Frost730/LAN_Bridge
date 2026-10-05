export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s';
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatETA(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || !isFinite(seconds) || seconds < 0) {
    return 'Calculating...';
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s remaining`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSecs = Math.round(seconds % 60);
  if (minutes < 60) {
    return `${minutes}m ${remainingSecs}s remaining`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return `${hours}h ${remainingMins}m remaining`;
}

export function formatTimestamp(timestampSecs: number): string {
  const date = new Date(timestampSecs * 1000);
  const now = new Date();

  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) {
    return `Today at ${timeStr}`;
  }
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeStr}`;
}
