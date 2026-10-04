export function waitForVisionSlot(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(new Error('已停止图片分析'));
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new Error('已停止图片分析')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
