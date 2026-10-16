import { Matrix4 } from "three";
import { indexAssets, unpack } from "./archive";
import { parseFbx } from "./fbx";
import { combineParts, transformedPart } from "./geometry";
import { imageInfo } from "./image";
import { readPrefab } from "./prefab";
import { list, number, readMaterial, record, validateMeta } from "./unity";
import { check, LIMITS } from "./types";
import type { Asset, MaterialInfo, MeshData, SceneData } from "./types";

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
  check(prefabs.length === 1, "単一の自己完結した Prefab が必要です。");
  const instances = readPrefab(prefabs[0].data, warnings);
  const decoded = new Map<string, MeshData[]>();
  let decodedVertices = 0,
    vertices = 0;
  const materials: MaterialInfo[] = [];
  const materialIndex = new Map<string, number>();
  const parts: { mesh: MeshData; slots: number[] }[] = [];
  const renderers: SceneData["source"]["renderers"] = [];
  for (const instance of instances) {
    const fbx = get(instance.mesh.guid, /\.fbx$/i);
    const importer = record(metadata.get(fbx.guid)?.ModelImporter);
    check(
      (importer.useFileScale ?? 1) === 1,
      "ModelImporter.useFileScale: 0 は未対応です。",
    );
    const importScale = number(importer.globalScale ?? 1);
    check(
      importScale >= 0.001 && importScale <= 1000,
      "ModelImporter.globalScale は 0.001–1000 が必要です。",
    );
    const names = list(importer.internalIDToNameTable)
      .filter(
        (item) => record(record(item).first)["43"] === instance.mesh.fileID,
      )
      .map((item) => String(record(item).second));
    check(
      names.length === 1,
      "ModelImporter の mesh fileID が欠落・曖昧です。",
    );
    let meshes = decoded.get(fbx.guid);
    if (!meshes) {
      meshes = await parseFbx(fbx.data);
      decodedVertices += meshes.reduce(
        (sum, m) => sum + m.positions.length / 3,
        0,
      );
      check(
        decodedVertices <= LIMITS.vertices,
        "読み込む FBX の合計頂点数が 500,000 の上限を超えています。",
      );
      decoded.set(fbx.guid, meshes);
    }
    const matches = meshes.filter((m) => m.name === names[0]);
    check(
      matches.length === 1,
      "FBX subasset と fileID の対応が欠落・曖昧です。",
    );
    const mesh = matches[0];
    vertices += mesh.positions.length / 3;
    check(
      vertices <= LIMITS.vertices,
      "部品の合計頂点数が 500,000 の上限を超えています。",
    );
    const slots = instance.materials.map((r) => {
      check(
        r.fileID === 2100000,
        "Material fileID は 2100000 のみ対応しています。",
      );
      const asset = get(r.guid, /\.mat$/i);
      let index = materialIndex.get(asset.guid);
      if (index === undefined) {
        check(
          materials.length < LIMITS.materials,
          "材質の合計が 128 の上限を超えています。",
        );
        index = materials.length;
        materials.push(readMaterial(asset, warnings));
        materialIndex.set(asset.guid, index);
      }
      return index;
    });
    parts.push({
      mesh: transformedPart(
        mesh,
        instance.world
          .clone()
          .multiply(
            new Matrix4().makeScale(importScale, importScale, importScale),
          ),
      ),
      slots,
    });
    renderers.push({
      name: instance.name,
      path: instance.path,
      meshName: mesh.name,
      transformID: instance.transformID,
      mesh: instance.mesh,
      materials: instance.materials,
      matrix: instance.world.toArray(),
      importScale,
    });
  }
  const textures: SceneData["textures"] = [];
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
  const ignored = assets.filter((a) => /\.(cs|dll|shader|js)$/i.test(a.path));
  if (ignored.length)
    warnings.push(
      `${ignored.length} 件のコード・シェーダーを実行せず無視しました。`,
    );
  return {
    mesh: combineParts(parts),
    materials,
    textures,
    warnings,
    assets: assets.map((a) => ({
      guid: a.guid,
      path: a.path,
      bytes: a.data.length,
    })),
    source: { prefab: prefabs[0].path, renderers },
    vertices,
  };
}
