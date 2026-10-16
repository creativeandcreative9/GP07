import { check, LIMITS } from "./types";

export function imageInfo(bytes: Uint8Array): {
  mime: string;
  width: number;
  height: number;
} {
  let width = 0,
    height = 0,
    mime = "";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length >= 33 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
  ) {
    check(
      view.getUint32(8) === 13 &&
        String.fromCharCode(...bytes.subarray(12, 16)) === "IHDR",
      "PNG IHDR が不正です。",
    );
    width = view.getUint32(16);
    height = view.getUint32(20);
    mime = "image/png";
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    mime = "image/jpeg";
    let pos = 2;
    while (pos + 4 <= bytes.length) {
      check(bytes[pos++] === 255, "JPEG マーカーが不正です。");
      while (bytes[pos] === 255) pos++;
      const marker = bytes[pos++];
      if (marker === 218 || marker === 217) break;
      const size = view.getUint16(pos);
      check(size >= 2 && pos + size <= bytes.length, "JPEG 長が不正です。");
      if ([192, 193, 194].includes(marker)) {
        check(size >= 8, "JPEG SOF が不正です。");
        height = view.getUint16(pos + 3);
        width = view.getUint16(pos + 5);
        break;
      }
      pos += size;
    }
  }
  check(
    width > 0 &&
      height > 0 &&
      width <= LIMITS.imageSide &&
      height <= LIMITS.imageSide,
    "PNG/JPEG のみ対応。画像は各辺 4096 px 以下が必要です。",
  );
  return { mime, width, height };
}
