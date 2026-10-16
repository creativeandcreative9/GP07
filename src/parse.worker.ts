import { parsePackage } from "./core/model";

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const scene = await parsePackage(new Uint8Array(event.data));
    self.postMessage({ ok: true, scene });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "解析に失敗しました。",
    });
  }
};
