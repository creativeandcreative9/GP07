import { check, LIMITS } from "./types";

export function validateAsciiFbx(bytes: Uint8Array): void {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  check(
    /FBXVersion:\s*7400\b/.test(source),
    "初版は静的 ASCII FBX 7.4 のみ対応しています。",
  );
  check(
    !/\b(?:__proto__|prototype|constructor)\b/.test(source),
    "FBX に予約キーがあります。",
  );
  check(
    !/^\s*(Video|Texture|Deformer|AnimationCurve|AnimationStack):/m.test(
      source,
    ),
    "埋め込み画像・FBX 内の外部画像参照・スキニング・アニメーションは未対応です。",
  );
  let depth = 0,
    nodes = 0;
  for (const char of source) {
    if (char === "{") {
      depth++;
      nodes++;
    }
    if (char === "}") depth--;
    check(
      depth >= 0 && depth <= 64 && nodes <= 20_000,
      "FBX 構造の上限を超えています。",
    );
  }
  check(depth === 0, "FBX の括弧が不正です。");
  let scalars = 0;
  for (const match of source.matchAll(
    /(\w+):\s*\*(\d+)\s*\{\s*a:\s*([^}]*)\}/g,
  )) {
    const count = Number(match[2]);
    scalars += count;
    check(
      scalars <= 4_500_000 && count <= LIMITS.indices,
      "FBX 配列が上限を超えています。",
    );
    const values = match[3].trim().split(",");
    check(
      values.length === count &&
        values.every(
          (v) =>
            /^\s*-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?\s*$/.test(v) &&
            Number.isFinite(Number(v)) &&
            Math.abs(Number(v)) < 1e9,
        ),
      "FBX 配列の長さまたは数値が不正です。",
    );
    if (match[1] === "PolygonVertexIndex") {
      check(
        count <= LIMITS.vertices &&
          count % 3 === 0 &&
          values.every(
            (v, i) =>
              Number.isInteger(Number(v)) &&
              (i % 3 === 2 ? Number(v) < 0 : Number(v) >= 0),
          ),
        "初版は 500,000 頂点以下の三角形 FBX が必要です。",
      );
    }
  }
}
