import { BufferAttribute, BufferGeometry, Matrix4 } from "three";
import { check, LIMITS } from "./types";
import type { MeshData } from "./types";

/** Apply positions, inverse-transpose normals, and reflection-aware winding. */
export function applyTransform(
  geometry: BufferGeometry,
  matrix: Matrix4,
): void {
  check(
    Math.abs(matrix.determinant()) >= 1e-12,
    "メッシュの Transform が特異です。",
  );
  geometry.applyMatrix4(matrix);
  if (matrix.determinant() < 0) {
    for (const attribute of Object.values(geometry.attributes)) {
      check(
        attribute instanceof BufferAttribute,
        "Interleaved geometry は未対応です。",
      );
      for (let i = 0; i < attribute.count; i += 3)
        for (let c = 0; c < attribute.itemSize; c++) {
          const a = (i + 1) * attribute.itemSize + c,
            b = (i + 2) * attribute.itemSize + c;
          const temp = attribute.array[a];
          attribute.array[a] = attribute.array[b];
          attribute.array[b] = temp;
        }
    }
  }
}

export function transformedPart(mesh: MeshData, unityWorld: Matrix4): MeshData {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(mesh.positions.slice(), 3),
  );
  geometry.setAttribute("normal", new BufferAttribute(mesh.normals.slice(), 3));
  geometry.setAttribute("uv", new BufferAttribute(mesh.uvs.slice(), 2));
  const reflect = new Matrix4().makeScale(-1, 1, 1);
  applyTransform(
    geometry,
    reflect.clone().multiply(unityWorld).multiply(reflect),
  );
  const result = {
    ...mesh,
    positions: new Float32Array(geometry.getAttribute("position").array),
    normals: new Float32Array(geometry.getAttribute("normal").array),
    uvs: new Float32Array(geometry.getAttribute("uv").array),
  };
  geometry.dispose();
  for (const array of [result.positions, result.normals, result.uvs])
    check(array.every(Number.isFinite), "Transform 後に非有限の値があります。");
  return result;
}

export function combineParts(
  parts: { mesh: MeshData; slots: number[] }[],
): MeshData {
  const count = parts.reduce((sum, p) => sum + p.mesh.positions.length / 3, 0);
  check(
    count > 0 && count <= LIMITS.vertices,
    "部品の合計頂点数が 500,000 の上限を超えています。",
  );
  const output: MeshData = {
    name: parts.length === 1 ? parts[0].mesh.name : `${parts.length} parts`,
    format: [...new Set(parts.map((p) => p.mesh.format))].join(" / "),
    positions: new Float32Array(count * 3),
    normals: new Float32Array(count * 3),
    uvs: new Float32Array(count * 2),
    groups: [],
  };
  let offset = 0;
  for (const { mesh, slots } of parts) {
    output.positions.set(mesh.positions, offset * 3);
    output.normals.set(mesh.normals, offset * 3);
    output.uvs.set(mesh.uvs, offset * 2);
    for (const group of mesh.groups) {
      check(
        group.materialIndex < slots.length &&
          Number.isSafeInteger(group.materialIndex) &&
          group.materialIndex >= 0,
        "FBX の素材スロットが Prefab と一致しません。",
      );
      output.groups.push({
        start: offset + group.start,
        count: group.count,
        materialIndex: slots[group.materialIndex],
      });
    }
    offset += mesh.positions.length / 3;
  }
  return output;
}
