interface TraceDownloadMessage {
  type: 'TRACE_DOWNLOAD_PING' | 'TRACE_DOWNLOAD_START' | 'TRACE_DOWNLOAD_CHUNK' | 'TRACE_DOWNLOAD_FINISH' | 'TRACE_DOWNLOAD_TRACK' | 'TRACE_DOWNLOAD_CLEANUP';
  base64?: string;
  downloadId?: number;
}

let chunks: Uint8Array[] = [];
let objectUrl = '';
let activeDownloadId: number | null = null;

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function reset(): void {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = '';
  activeDownloadId = null;
  chunks = [];
}

chrome.runtime.onMessage.addListener((message: TraceDownloadMessage, _sender, sendResponse) => {
  if (message.type === 'TRACE_DOWNLOAD_PING') {
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'TRACE_DOWNLOAD_START') {
    reset();
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'TRACE_DOWNLOAD_CHUNK') {
    if (!message.base64) {
      sendResponse({ ok: false, message: 'A trace chunk was empty.' });
      return false;
    }
    chunks.push(decodeBase64(message.base64));
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'TRACE_DOWNLOAD_FINISH') {
    void (async () => {
      if (!chunks.length) throw new Error('No trace chunks were received.');
      const blob = new Blob(chunks.map(chunk => Uint8Array.from(chunk)), { type: 'application/zip' });
      objectUrl = URL.createObjectURL(blob);
      chunks = [];
      sendResponse({ ok: true, objectUrl, size: blob.size });
    })().catch(error => {
      const message = error instanceof Error ? error.message : 'Trace download failed.';
      sendResponse({ ok: false, message });
    });
    return true;
  }
  if (message.type === 'TRACE_DOWNLOAD_TRACK') {
    activeDownloadId = message.downloadId ?? null;
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'TRACE_DOWNLOAD_CLEANUP' && message.downloadId === activeDownloadId) {
    reset();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
