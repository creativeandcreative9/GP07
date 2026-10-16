import { LoadingManager, Matrix4, Mesh } from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { validateAsciiFbx } from "./fbx-ascii";
import { isBinaryFbx, normalizeBinaryFbx } from "./fbx-binary";
import { applyTransform } from "./geometry";
import { check, LIMITS } from "./types";
import type { MeshData } from "./types";

/** Parse each FBX once; geometry selection later uses the exact meta subasset name. */
export async function parseFbx(bytes: Uint8Array): Promise<MeshData[]> {
  check(bytes.length <= LIMITS.fbx, "FBX は 16 MiB 以下が必要です。");
  const binary = isBinaryFbx(bytes);
  let buffer: ArrayBuffer;
  if (binary) buffer = await normalizeBinaryFbx(bytes);
  else {
    validateAsciiFbx(bytes);
    buffer = new Uint8Array(bytes).buffer;
  }
  const manager = new LoadingManager();
  manager.setURLModifier(() => {
    throw new Error("FBX の外部リソース読み込みは禁止されています。");
  });
  const root = new FBXLoader(manager).parse(buffer, "");
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  try {
    check(
      meshes.length > 0 &&
        meshes.length <= LIMITS.meshes &&
        meshes.every((m) => !("isSkinnedMesh" in m)),
      "FBX は 1–32 個の静的メッシュが必要です。",
    );
    check(
      meshes.reduce(
        (sum, m) => sum + (m.geometry.getAttribute("position")?.count ?? 0),
        0,
      ) <= LIMITS.vertices,
      "FBX の合計頂点数が 500,000 の上限を超えています。",
    );
    root.updateMatrixWorld(true);
    const units = root.userData.unitScaleFactor;
    check(
      typeof units === "number" &&
        Number.isFinite(units) &&
        units >= 0.1 &&
        units <= 10000,
      "FBX UnitScaleFactor は 0.1–10000 の明示値が必要です。",
    );
    const meters = units / 100;
    return meshes.map((mesh) => {
      let geometry = mesh.geometry.clone();
      if (geometry.index) {
        const old = geometry;
        geometry = geometry.toNonIndexed();
        old.dispose();
      }
      try {
        const p = geometry.getAttribute("position");
        check(p?.count > 0 && p.count % 3 === 0, "三角形メッシュが必要です。");
        applyTransform(
          geometry,
          new Matrix4()
            .makeScale(-meters, meters, meters)
            .multiply(mesh.matrixWorld),
        );
        if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
        const groups = geometry.groups.length
          ? geometry.groups.map((g) => ({
              ...g,
              materialIndex: g.materialIndex ?? 0,
            }))
          : [{ start: 0, count: p.count, materialIndex: 0 }];
        let end = 0;
        for (const g of groups) {
          check(
            g.start === end &&
              g.count > 0 &&
              g.count % 3 === 0 &&
              Number.isSafeInteger(g.materialIndex) &&
              g.materialIndex >= 0,
            "FBX の素材スロットが不正です。",
          );
          end += g.count;
        }
        check(end === p.count, "素材スロットが全ポリゴンを覆っていません。");
        const result: MeshData = {
          name: geometry.name,
          format: binary ? "Binary FBX 7.4" : "ASCII FBX 7.4",
          positions: new Float32Array(p.array),
          normals: new Float32Array(geometry.getAttribute("normal").array),
          uvs: geometry.getAttribute("uv")
            ? new Float32Array(geometry.getAttribute("uv").array)
            : new Float32Array(p.count * 2),
          groups,
        };
        for (const array of [result.positions, result.normals, result.uvs])
          check(array.every(Number.isFinite), "FBX に非有限の値があります。");
        return result;
      } finally {
        geometry.dispose();
      }
    });
  } finally {
    for (const geometry of new Set(meshes.map((m) => m.geometry)))
      geometry.dispose();
    for (const material of new Set(
      meshes.flatMap((m) =>
        Array.isArray(m.material) ? m.material : [m.material],
      ),
    ))
      material.dispose();
  }
}
