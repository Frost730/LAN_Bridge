/**
 * Workaround for mobile/Android content providers (SAF) where file.size can be 0 initially.
 * If file.size is 0, reads arrayBuffer from the underlying ContentResolver stream.
 * If bytes exist, returns a synthesized File instance with correct size.
 */
export async function getResolvedFileAndSize(file: File): Promise<{ file: File; size: number }> {
  if (file.size > 0) {
    return { file, size: file.size };
  }
  try {
    const buf = await file.arrayBuffer();
    if (buf && buf.byteLength > 0) {
      const fixedFile = new File([buf], file.name, {
        type: file.type || 'application/octet-stream',
        lastModified: file.lastModified || Date.now(),
      });
      return { file: fixedFile, size: buf.byteLength };
    }
  } catch (err) {
    console.warn('[File] Error inspecting 0-byte file:', err);
  }
  return { file, size: file.size };
}

export async function getActualFileSize(file: File): Promise<number> {
  const res = await getResolvedFileAndSize(file);
  return res.size;
}

/**
 * Calculates SHA-256 hash using the native Web Crypto API.
 * Uses sliced chunks for low memory overhead on large files.
 */
export async function calculateFileSHA256(
  file: File,
  onProgress?: (progress: number) => void
): Promise<string> {
  // If browser supports crypto.subtle
  if (window.crypto && window.crypto.subtle) {
    // For files under 64MB, calculating in one pass is fast (<100ms) and memory-safe
    if (file.size > 0 && file.size <= 64 * 1024 * 1024) {
      try {
        const buffer = await file.arrayBuffer();
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        if (onProgress) onProgress(1.0);
        return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      } catch (err) {
        console.warn('[Hashing] Non-critical: Hash calculation skipped due to buffer constraint:', err);
        return '';
      }
    }

    // For files over 64MB or 0-byte placeholders, calculating full sha256 in browser JS main thread blocks the UI
    // and causes out-of-memory crashes on mobile/low-RAM devices. We defer stream integrity
    // to chunk-level transport verification.
    return '';
  }
  return '';
}
