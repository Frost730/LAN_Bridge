export interface TransferEngineConfig {
  concurrentTransfers: number;
  chunkSize: number;
  performanceMode: boolean;
}

export function getTransferConfig(): TransferEngineConfig {
  const perf = localStorage.getItem('lanbridge_performance_mode') === 'true';
  const savedConcurrency = parseInt(localStorage.getItem('lanbridge_concurrent_transfers') || '3', 10);
  const savedChunkSize = parseInt(localStorage.getItem('lanbridge_chunk_size') || '2097152', 10);

  const concurrency = perf ? Math.max(savedConcurrency, 4) : Math.max(1, Math.min(6, savedConcurrency || 3));
  const chunkSize = perf ? Math.max(savedChunkSize, 4 * 1024 * 1024) : (savedChunkSize || 2 * 1024 * 1024);

  return {
    concurrentTransfers: concurrency,
    chunkSize: chunkSize,
    performanceMode: perf,
  };
}
