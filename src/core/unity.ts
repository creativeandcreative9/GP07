import { isAlias, parseDocument, visit } from "yaml";
import { check, LIMITS, text } from "./types";
import type { Asset, MaterialInfo, Ref } from "./types";

export type RecordValue = Record<string, unknown>;
export function record(v: unknown): RecordValue {
  check(
    !!v && typeof v === "object" && !Array.isArray(v),
    "Unity データの構造が不正です。",
  );
  return v as RecordValue;
}
export function list(v: unknown): unknown[] {
  check(Array.isArray(v), "Unity 配列が不正です。");
  return v;
}
export function number(v: unknown): number {
  check(typeof v === "number" && Number.isFinite(v), "有限の数値が必要です。");
  return v;
}
export function ref(v: unknown): Ref {
  const r = record(v);
  const fileID = number(r.fileID);
  check(Number.isSafeInteger(fileID), "fileID が不正です。");
  check(
    r.guid === undefined ||
      (typeof r.guid === "string" && /^[a-f0-9]{32}$/i.test(r.guid)),
    "GUID が不正です。",
  );
  return {
    fileID,
    guid: typeof r.guid === "string" ? r.guid.toLowerCase() : undefined,
  };
}

export function yaml(source: string): RecordValue {
  check(source.length <= LIMITS.text, "YAML が 1 MiB を超えています。");
  // Unity document tags are stripped by documents(); all remaining tags and aliases are forbidden.
  const doc = parseDocument(source, {
    schema: "core",
    uniqueKeys: true,
    strict: true,
  });
  check(
    !doc.errors.length && !doc.warnings.length,
    "YAML の構文またはタグが不正です。",
  );
  let nodes = 0;
  visit(doc, (key, node, path) => {
    void key;
    check(
      ++nodes <= 20_000 && path.length <= 32,
      "YAML の深さ・ノード数が上限を超えています。",
    );
    check(
      !isAlias(node) &&
        !(
          node &&
          typeof node === "object" &&
          (("anchor" in node && node.anchor) || ("tag" in node && node.tag))
        ),
      "YAML alias・anchor・タグは使用できません。",
    );
  });
  return record(doc.toJS({ maxAliasCount: 0 }));
}

export function documents(
  bytes: Uint8Array,
): { id: number; type: number; value: RecordValue }[] {
  const source = text(bytes).replace(/^%.*\r?\n/gm, "");
  const parts = source.split(/^--- !u!(\d+) &(-?\d+)\s*\r?\n/gm);
  check(
    parts.length > 1 && !parts[0].trim(),
    "対応する Unity YAML 文書ではありません。",
  );
  const out = [];
  const ids = new Set<number>();
  for (let i = 1; i < parts.length; i += 3) {
    const id = Number(parts[i + 1]);
    check(
      Number.isSafeInteger(id) && !ids.has(id),
      "Unity 文書 fileID が重複または不正です。",
    );
    ids.add(id);
    out.push({ type: Number(parts[i]), id, value: yaml(parts[i + 2]) });
  }
  return out;
}

export function validateMeta(asset: Asset): RecordValue {
  const meta = yaml(text(asset.meta));
  check(
    String(meta.guid).toLowerCase() === asset.guid,
    "asset.meta と entry の GUID が一致しません。",
  );
  return meta;
}

export const LILTOON_OUTLINE_GUID = "efa77a80ca0344749b4f19fdd5891cbe";

export function readMaterial(asset: Asset, warnings: string[]): MaterialInfo {
  const docs = documents(asset.data);
  check(
    docs.length === 1 && docs[0].type === 21 && docs[0].id === 2100000,
    "単一の Material (fileID 2100000) のみ対応しています。",
  );
  const m = record(docs[0].value.Material);
  const shader = ref(m.m_Shader);
  const supported =
    shader.guid === LILTOON_OUTLINE_GUID && shader.fileID === 4800000;
  if (!supported)
    warnings.push(
      `${asset.path}: 未知のシェーダー。紫色の代替材質で表示します。`,
    );
  const props = record(m.m_SavedProperties);
  const colors: Record<string, unknown> = {};
  const floats: Record<string, unknown> = {};
  const tex: Record<string, unknown> = {};
  for (const [target, raw] of [
    [colors, props.m_Colors],
    [floats, props.m_Floats],
    [floats, props.m_Ints],
    [tex, props.m_TexEnvs],
  ] as const) {
    for (const item of list(raw ?? [])) {
      for (const [k, v] of Object.entries(record(item))) {
        check(!(k in target), "材質プロパティが重複しています。");
        target[k] = v;
      }
    }
  }
  const known = new Set([
    "_Color",
    "_ShadowColor",
    "_OutlineColor",
    "_UseShadow",
    "_ShadowBorder",
    "_OutlineWidth",
    "_MainTex",
  ]);
  const unknown = Object.keys({ ...colors, ...floats, ...tex }).filter(
    (k) => !known.has(k),
  );
  if (unknown.length)
    warnings.push(
      `${asset.path}: 未対応プロパティ ${unknown.join(", ")} を省略しました。`,
    );
  if (m.m_ValidKeywords && list(m.m_ValidKeywords).length)
    warnings.push(`${asset.path}: shader keyword は再現しません。`);
  const rgb = (
    v: unknown,
    fallback: [number, number, number],
  ): [number, number, number] => {
    if (v === undefined) return fallback;
    const c = record(v);
    const a = c.a === undefined ? 1 : number(c.a);
    if (a !== 1)
      warnings.push(`${asset.path}: 透過を省略し、不透明で表示します。`);
    return [number(c.r), number(c.g), number(c.b)].map((n) =>
      Math.min(1, Math.max(0, n)),
    ) as [number, number, number];
  };
  const main = tex._MainTex === undefined ? undefined : record(tex._MainTex);
  const t = main ? ref(main.m_Texture) : undefined;
  if (t?.fileID)
    check(
      t.fileID === 2800000 && t.guid,
      "MainTex の fileID は 2800000 のみ対応しています。",
    );
  const xy = (v: unknown, fallback: [number, number]): [number, number] =>
    v === undefined ? fallback : [number(record(v).x), number(record(v).y)];
  const useShadow = number(floats._UseShadow ?? 0);
  return {
    guid: asset.guid,
    name: String(m.m_Name ?? asset.path),
    supported,
    color: supported ? rgb(colors._Color, [1, 1, 1]) : [0.8, 0.3, 1],
    shadow: rgb(colors._ShadowColor, [0.82, 0.76, 0.85]),
    border:
      useShadow === 0
        ? -1
        : Math.min(1, Math.max(0, number(floats._ShadowBorder ?? 0.5))),
    outline: Math.min(0.15, Math.max(0, number(floats._OutlineWidth ?? 0.08))),
    outlineColor: rgb(colors._OutlineColor, [0.6, 0.56, 0.73]),
    textureGuid: t?.fileID ? t.guid : undefined,
    scale: xy(main?.m_Scale, [1, 1]),
    offset: xy(main?.m_Offset, [0, 0]),
  };
}
