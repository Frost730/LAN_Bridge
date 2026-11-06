export interface TransferEngineConfig {
  concurrentTransfers: number;
  chunkSize: number;
  performanceMode: boolean;
  isMobile: boolean;
}

export function getTransferConfig(): TransferEngineConfig {
  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const perf = localStorage.getItem('lanbridge_performance_mode') === 'true';
  const defaultConcurrency = isMobile ? '2' : '3';
  const defaultChunkSize = isMobile ? '2097152' : '4194304'; // 2MB on mobile, 4MB on desktop

  const savedConcurrency = parseInt(localStorage.getItem('lanbridge_concurrent_transfers') || defaultConcurrency, 10);
  const savedChunkSize = parseInt(localStorage.getItem('lanbridge_chunk_size') || defaultChunkSize, 10);

  const concurrency = perf
    ? Math.max(savedConcurrency, isMobile ? 3 : 4)
    : Math.max(1, Math.min(6, savedConcurrency || (isMobile ? 2 : 3)));
  const chunkSize = perf
    ? Math.max(savedChunkSize, isMobile ? 4 * 1024 * 1024 : 8 * 1024 * 1024)
    : (savedChunkSize || (isMobile ? 2 * 1024 * 1024 : 4 * 1024 * 1024));

  return {
    concurrentTransfers: concurrency,
    chunkSize: chunkSize,
    performanceMode: perf,
    isMobile: isMobile,
  };
}
