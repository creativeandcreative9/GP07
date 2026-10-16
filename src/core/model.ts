import { BufferAttribute, LoadingManager, Mesh } from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { indexAssets, unpack } from "./archive";
import { imageInfo } from "./image";
import {
  documents,
  list,
  number,
  readMaterial,
  record,
  ref,
  validateMeta,
} from "./unity";
import { check, LIMITS } from "./types";
import type { Asset, MeshData, SceneData } from "./types";

export function parseMesh(
  bytes: Uint8Array,
  name: string,
  slots: number,
): MeshData {
  // Initial profile: ASCII FBX 7.4, static geometry only. Reject compressed/binary FBX
  // before FBXLoader so its unbounded compressed arrays cannot allocate memory.
  check(bytes.length <= 16 * 1024 ** 2, "初版の FBX は 16 MiB 以下です。");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  check(
    /FBXVersion:\s*7400\b/.test(source) &&
      !source.startsWith("Kaydara FBX Binary"),
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
  const manager = new LoadingManager();
  manager.setURLModifier(() => {
    throw new Error("FBX の外部リソース読み込みは禁止されています。");
  });
  const root = new FBXLoader(manager).parse(bytes.slice().buffer, "");
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  check(meshes.length === 1, "初版は FBX 内に単一の静的メッシュが必要です。");
  const mesh = meshes[0];
  check(
    !("isSkinnedMesh" in mesh) && mesh.geometry.name === name,
    "FBX subasset と fileID の対応が解決できません。",
  );
  root.updateMatrixWorld(true);
  let geometry = mesh.geometry;
  if (geometry.index) geometry = geometry.toNonIndexed();
  check(
    geometry.getAttribute("position")?.count <= LIMITS.vertices,
    "頂点数が 500,000 の上限を超えています。",
  );
  geometry.applyMatrix4(mesh.matrixWorld);
  // FBX coordinates are treated as Y-up; reflection matches Unity's handedness.
  geometry.scale(-1, 1, 1);
  const p = geometry.getAttribute("position");
  // Reflecting positions reverses winding; swap vertices in every triangle.
  for (const attribute of Object.values(geometry.attributes)) {
    check(
      attribute instanceof BufferAttribute,
      "Interleaved geometry は未対応です。",
    );
    for (let i = 0; i < attribute.count; i += 3) {
      for (let c = 0; c < attribute.itemSize; c++) {
        const a = (i + 1) * attribute.itemSize + c,
          b = (i + 2) * attribute.itemSize + c;
        const tmp = attribute.array[a];
        attribute.array[a] = attribute.array[b];
        attribute.array[b] = tmp;
      }
    }
  }
  check(p.count > 0 && p.count % 3 === 0, "三角形メッシュが必要です。");
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  const groups = geometry.groups.length
    ? geometry.groups.map((g) => ({
        ...g,
        materialIndex: g.materialIndex ?? 0,
      }))
    : [{ start: 0, count: p.count, materialIndex: 0 }];
  let end = 0;
  for (const group of groups) {
    check(
      group.start === end &&
        group.count % 3 === 0 &&
        group.materialIndex >= 0 &&
        group.materialIndex < slots,
      "FBX の素材スロットが Prefab と一致しません。",
    );
    end += group.count;
  }
  check(end === p.count, "素材スロットが全ポリゴンを覆っていません。");
  const result = {
    name,
    positions: new Float32Array(p.array),
    normals: new Float32Array(geometry.getAttribute("normal").array),
    uvs: geometry.getAttribute("uv")
      ? new Float32Array(geometry.getAttribute("uv").array)
      : new Float32Array(p.count * 2),
    groups,
  };
  for (const array of [result.positions, result.normals, result.uvs])
    check(array.every(Number.isFinite), "FBX に非有限の値があります。");
  geometry.dispose();
  for (const m of meshes)
    for (const mat of Array.isArray(m.material) ? m.material : [m.material])
      mat.dispose();
  return result;
}

export async function parsePackage(input: Uint8Array): Promise<SceneData> {
  const assets = indexAssets(await unpack(input));
  const metadata = new Map(assets.map((a) => [a.guid, validateMeta(a)]));
  const warnings = [
    "限定トゥーン近似です。lilToon 完全互換・Unity の外観一致は未検証です。",
  ];
  const byGuid = new Map(assets.map((a) => [a.guid, a]));
  const get = (guid: string | undefined, extension: RegExp): Asset => {
    const asset = guid ? byGuid.get(guid) : undefined;
    check(
      asset && extension.test(asset.path),
      "参照先が欠落しているか、対応するアセット形式ではありません。",
    );
    return asset;
  };
  const prefabs = assets.filter((a) => /\.prefab$/i.test(a.path));
  check(prefabs.length === 1, "初版は単一の自己完結した Prefab が必要です。");
  const docs = documents(prefabs[0].data);
  check(
    docs.every((d) => [1, 4, 23, 33].includes(d.type)),
    "Prefab の未対応コンポーネント・Variant を検出しました。",
  );
  const ofType = (type: number, key: string) => {
    const found = docs.filter((d) => d.type === type);
    check(
      found.length === 1,
      "単一 GameObject・Transform・MeshFilter・MeshRenderer のみ対応しています。",
    );
    return { id: found[0].id, data: record(found[0].value[key]) };
  };
  const go = ofType(1, "GameObject"),
    transform = ofType(4, "Transform");
  const filter = ofType(33, "MeshFilter"),
    renderer = ofType(23, "MeshRenderer");
  const components = list(go.data.m_Component)
    .map((c) => ref(record(c).component).fileID)
    .sort();
  check(
    JSON.stringify(components) ===
      JSON.stringify([transform.id, filter.id, renderer.id].sort()),
    "Prefab component 参照が一致しません。",
  );
  for (const c of [transform, filter, renderer])
    check(
      ref(c.data.m_GameObject).fileID === go.id,
      "GameObject 参照が一致しません。",
    );
  check(
    ref(transform.data.m_Father).fileID === 0 &&
      list(transform.data.m_Children).length === 0,
    "ネストした Prefab は未対応です。",
  );
  for (const [key, expected] of [
    ["m_LocalPosition", [0, 0, 0]],
    ["m_LocalScale", [1, 1, 1]],
    ["m_LocalRotation", [0, 0, 0, 1]],
  ] as const) {
    const value = record(transform.data[key]);
    check(
      expected.every((n, i) => number(value[["x", "y", "z", "w"][i]]) === n),
      "初版の Prefab Transform は位置0・回転0・スケール1が必要です。",
    );
  }
  const meshRef = ref(filter.data.m_Mesh);
  const fbx = get(meshRef.guid, /\.fbx$/i);
  const importer = record(metadata.get(fbx.guid)?.ModelImporter);
  const table = list(importer.internalIDToNameTable);
  const names = table
    .filter((item) => record(record(item).first)["43"] === meshRef.fileID)
    .map((item) => String(record(item).second));
  check(names.length === 1, "ModelImporter の mesh fileID が欠落・曖昧です。");
  const materialRefs = list(renderer.data.m_Materials).map(ref);
  check(
    materialRefs.length > 0 && materialRefs.length <= 32,
    "素材スロット数が不正です。",
  );
  const materials = materialRefs.map((r) => {
    check(
      r.fileID === 2100000,
      "Material fileID は 2100000 のみ対応しています。",
    );
    return readMaterial(get(r.guid, /\.mat$/i), warnings);
  });
  const textures = [];
  let pixels = 0;
  for (const guid of new Set(
    materials.map((m) => m.textureGuid).filter((g): g is string => !!g),
  )) {
    const asset = get(guid, /\.(png|jpe?g)$/i);
    const info = imageInfo(asset.data);
    pixels += info.width * info.height;
    check(
      pixels <= LIMITS.pixels,
      "画像の合計が 32M pixels の上限を超えています。",
    );
    textures.push({ guid, bytes: asset.data, mime: info.mime });
  }
  const mesh = parseMesh(fbx.data, names[0], materials.length);
  const ignored = assets.filter((a) => /\.(cs|dll|shader|js)$/i.test(a.path));
  if (ignored.length)
    warnings.push(
      `${ignored.length} 件のコード・シェーダーを実行せず無視しました。`,
    );
  return {
    mesh,
    materials,
    textures,
    warnings,
    assets: assets.map((a) => ({
      guid: a.guid,
      path: a.path,
      bytes: a.data.length,
    })),
    source: { mesh: meshRef, materials: materialRefs, prefab: prefabs[0].path },
    vertices: mesh.positions.length / 3,
  };
}
