import { check, LIMITS } from "./types";

export const FBX_MAGIC = new Uint8Array([
  75, 97, 121, 100, 97, 114, 97, 32, 70, 66, 88, 32, 66, 105, 110, 97, 114, 121,
  32, 32, 0, 26, 0,
]);
const decoder = new TextDecoder("utf-8", { fatal: true });
const widths: Record<string, number> = { b: 1, c: 1, d: 8, f: 4, i: 4, l: 8 };
const reserved = new Set(["__proto__", "prototype", "constructor"]);

export function isBinaryFbx(bytes: Uint8Array): boolean {
  return FBX_MAGIC.every((value, i) => bytes[i] === value);
}

async function inflate(
  bytes: Uint8Array,
  expected: number,
): Promise<Uint8Array> {
  // Native streaming zlib checks the checksum/trailer. Do not feed compressed
  // properties to FBXLoader's unbounded synchronous inflater.
  const reader = new Blob([new Uint8Array(bytes).buffer])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"))
    .getReader();
  const output = new Uint8Array(expected);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      check(size <= expected, "FBX 圧縮配列の展開長が宣言値を超えています。");
      output.set(value, size - value.length);
    }
    check(size === expected, "FBX 圧縮配列の展開長が一致しません。");
    return output;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Validate 32-bit node records, then rebuild an uncompressed in-memory FBX.
 * Original user bytes are never modified. All offsets refer to the rebuilt file.
 */
export async function normalizeBinaryFbx(
  bytes: Uint8Array,
): Promise<ArrayBuffer> {
  check(bytes.length <= LIMITS.fbx, "FBX は 16 MiB 以下が必要です。");
  check(
    bytes.length >= 27 && isBinaryFbx(bytes),
    "FBX バイナリヘッダーが不正です。",
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  check(
    view.getUint32(23, true) === 7400,
    "バイナリ FBX は 7.4 のみ対応しています。",
  );
  let cursor = 27,
    outputSize = 0,
    nodes = 0,
    properties = 0,
    scalars = 0;
  const chunks: Uint8Array[] = [];
  function emit(chunk: Uint8Array) {
    outputSize += chunk.length;
    check(
      outputSize <= LIMITS.fbxExpanded,
      "FBX の展開合計が 64 MiB を超えています。",
    );
    chunks.push(chunk);
  }
  function take(size: number, end: number): Uint8Array {
    check(
      Number.isSafeInteger(size) && size >= 0 && cursor + size <= end,
      "FBX の長さ・境界が不正です。",
    );
    const result = bytes.subarray(cursor, cursor + size);
    cursor += size;
    return result;
  }
  function string(data: Uint8Array): string {
    check(data.length <= LIMITS.text, "FBX 文字列が 1 MiB を超えています。");
    // FBX object names may have a NUL + class suffix. Match FBXLoader's first-NUL rule.
    const zero = data.indexOf(0);
    const value = decoder.decode(zero < 0 ? data : data.subarray(0, zero));
    check(!reserved.has(value), "FBX に予約キーがあります。");
    return value;
  }
  async function property(end: number, name: string) {
    const start = cursor;
    const type = String.fromCharCode(take(1, end)[0]);
    const fixed: Record<string, number> = {
      C: 1,
      D: 8,
      F: 4,
      I: 4,
      L: 8,
      Y: 2,
    };
    if (type in fixed) {
      const data = take(fixed[type], end);
      const dv = new DataView(data.buffer, data.byteOffset, data.length);
      if (type === "D" || type === "F") {
        const value =
          type === "D" ? dv.getFloat64(0, true) : dv.getFloat32(0, true);
        check(
          Number.isFinite(value) && Math.abs(value) < 1e9,
          "FBX に不正な数値があります。",
        );
      }
      if (type === "L")
        check(
          Number.isSafeInteger(Number(dv.getBigInt64(0, true))),
          "FBX の ID が安全な整数範囲を超えています。",
        );
      emit(bytes.subarray(start, cursor));
      return;
    }
    if (type === "S") {
      take(4, end);
      const data = take(view.getUint32(cursor - 4, true), end);
      string(data);
      emit(bytes.subarray(start, cursor));
      return;
    }
    check(
      type in widths,
      "未対応の FBX プロパティ型です。raw blob は読み込みません。",
    );
    take(12, end);
    const count = view.getUint32(start + 1, true);
    const encoding = view.getUint32(start + 5, true);
    const packedLength = view.getUint32(start + 9, true);
    scalars += count;
    check(
      count <= LIMITS.indices && scalars <= LIMITS.fbxScalars,
      "FBX 配列が上限を超えています。",
    );
    check(encoding === 0 || encoding === 1, "FBX 配列の圧縮方式が不正です。");
    check(
      name !== "PolygonVertexIndex" ||
        (count > 0 &&
          count <= LIMITS.vertices &&
          count % 3 === 0 &&
          type === "i"),
      "FBX は 500,000 頂点以下の三角形が必要です。",
    );
    const length = count * widths[type];
    check(
      encoding !== 0 || packedLength === length,
      "FBX 非圧縮配列の長さが不正です。",
    );
    const packed = take(packedLength, end);
    const data = encoding === 1 ? await inflate(packed, length) : packed;
    const dv = new DataView(data.buffer, data.byteOffset, data.length);
    for (let i = 0; i < count; i++) {
      const value =
        type === "d"
          ? dv.getFloat64(i * 8, true)
          : type === "f"
            ? dv.getFloat32(i * 4, true)
            : type === "i"
              ? dv.getInt32(i * 4, true)
              : type === "l"
                ? Number(dv.getBigInt64(i * 8, true))
                : data[i];
      check(
        Number.isFinite(value) && Math.abs(value) < 1e9,
        "FBX 配列に不正な数値があります。",
      );
      if (name === "PolygonVertexIndex")
        check(
          i % 3 === 2 ? value < 0 : value >= 0,
          "三角形以外の FBX ポリゴンは未対応です。",
        );
    }
    const header = new Uint8Array(13);
    const out = new DataView(header.buffer);
    header[0] = type.charCodeAt(0);
    out.setUint32(1, count, true);
    out.setUint32(9, length, true); // encoding = 0
    emit(header);
    emit(data);
  }
  async function node(parentEnd: number, depth: number): Promise<boolean> {
    check(depth <= 64 && ++nodes <= 20_000, "FBX 構造の上限を超えています。");
    const start = cursor;
    const raw = take(13, parentEnd);
    const end = view.getUint32(start, true);
    if (end === 0) {
      check(
        raw.every((v) => v === 0),
        "FBX 終端レコードが不正です。",
      );
      emit(raw);
      return false;
    }
    const count = view.getUint32(start + 4, true);
    const propertyLength = view.getUint32(start + 8, true);
    const nameBytes = take(raw[12], parentEnd);
    const name = string(nameBytes);
    check(
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !nameBytes.includes(0),
      "FBX node 名が不正です。",
    );
    check(
      !["Video", "Texture", "Deformer"].includes(name) &&
        !name.startsWith("Animation"),
      "埋め込み画像・FBX 内の外部画像参照・スキニング・アニメーションは未対応です。",
    );
    properties += count;
    check(
      count <= 20_000 && properties <= 100_000,
      "FBX プロパティ数が上限を超えています。",
    );
    const propertyEnd = cursor + propertyLength;
    check(
      end >= propertyEnd && end <= parentEnd,
      "FBX node offset が境界外です。",
    );
    const header = new Uint8Array(raw);
    const outStart = outputSize;
    emit(header);
    emit(nameBytes);
    const propStart = outputSize;
    for (let i = 0; i < count; i++) await property(propertyEnd, name);
    check(cursor === propertyEnd, "FBX propertyListLen が一致しません。");
    const propLength = outputSize - propStart;
    while (cursor < end) {
      const child = await node(end, depth + 1);
      if (!child) check(cursor === end, "FBX node 終端後にデータがあります。");
    }
    check(
      cursor === end && outputSize > outStart,
      "FBX node 終端が一致しません。",
    );
    const out = new DataView(header.buffer);
    out.setUint32(0, outputSize, true);
    out.setUint32(8, propLength, true);
    return true;
  }
  emit(bytes.subarray(0, 27));
  // Reserve the minimum opaque footer size. The root NULL record is mandatory.
  while (await node(bytes.length - 160, 0)) {
    /* validated root nodes */
  }
  check(
    bytes.length - cursor >= 160 && bytes.length - cursor <= 176,
    "FBX footer の長さが不正です。",
  );
  const footer = new Uint8Array(176);
  footer.set(bytes.subarray(cursor));
  emit(footer);
  const output = new Uint8Array(outputSize);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output.buffer;
}
