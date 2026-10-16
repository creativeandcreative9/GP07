import { Matrix4, Quaternion, Vector3 } from "three";
import { documents, list, number, record, ref } from "./unity";
import { check, LIMITS } from "./types";
import type { Ref } from "./types";

export interface RenderInstance {
  name: string;
  path: string;
  transformID: number;
  mesh: Ref;
  materials: Ref[];
  world: Matrix4;
}

function localID(value: unknown): number {
  const r = ref(value);
  check(!r.guid, "Prefab 内の参照に外部 GUID は使用できません。");
  return r.fileID;
}
function flag(value: unknown): boolean {
  const n = number(value ?? 1);
  check(n === 0 || n === 1, "Prefab の有効フラグは 0 または 1 が必要です。");
  return n === 1;
}
function vector(value: unknown): Vector3 {
  const r = record(value);
  const v = new Vector3(number(r.x), number(r.y), number(r.z));
  check(
    v.toArray().every((n) => Math.abs(n) <= 1e6),
    "Prefab Transform の数値が大きすぎます。",
  );
  return v;
}
function localMatrix(data: Record<string, unknown>): Matrix4 {
  const p = vector(data.m_LocalPosition),
    s = vector(data.m_LocalScale);
  check(
    s.toArray().every((n) => Math.abs(n) >= 0.001 && Math.abs(n) <= 1000),
    "Prefab Transform のスケールは絶対値 0.001–1000 が必要です。",
  );
  const r = record(data.m_LocalRotation);
  const q = new Quaternion(number(r.x), number(r.y), number(r.z), number(r.w));
  check(
    Math.abs(q.lengthSq() - 1) <= 0.001,
    "Prefab の回転 quaternion が正規化されていません。",
  );
  return new Matrix4().compose(p, q.normalize(), s);
}

/** Validate every component and reciprocal parent/child link before drawing. */
export function readPrefab(
  bytes: Uint8Array,
  warnings: string[],
): RenderInstance[] {
  const docs = documents(bytes);
  check(
    docs.length <= LIMITS.prefabNodes * 4 &&
      docs.every((d) => d.id !== 0 && [1, 4, 23, 33].includes(d.type)),
    "Prefab の未対応コンポーネント・Variant、または文書数超過を検出しました。",
  );
  const byID = new Map(docs.map((d) => [d.id, d]));
  const gameObjects = docs.filter((d) => d.type === 1);
  check(
    gameObjects.length > 0 && gameObjects.length <= LIMITS.prefabNodes,
    "Prefab の GameObject 数が 128 の上限を超えています。",
  );
  const used = new Set<number>();
  const nodes = new Map<
    number,
    {
      name: string;
      children: number[];
      parent: number;
      local: Matrix4;
      active: boolean;
      renderer?: Omit<RenderInstance, "world" | "path">;
      enabled: boolean;
    }
  >();
  for (const go of gameObjects) {
    const data = record(go.value.GameObject);
    check(
      typeof data.m_Name === "string" && data.m_Name.length <= 256,
      "GameObject 名が不正または長すぎます。",
    );
    const ids = list(data.m_Component).map((c) => localID(record(c).component));
    check(
      new Set(ids).size === ids.length,
      "Prefab component 参照が重複しています。",
    );
    const components = ids.map((id) => {
      const d = byID.get(id);
      check(
        d && [4, 23, 33].includes(d.type) && !used.has(id),
        "Prefab component 参照が欠落・重複しています。",
      );
      used.add(id);
      const key =
        d.type === 4
          ? "Transform"
          : d.type === 23
            ? "MeshRenderer"
            : "MeshFilter";
      const value = record(d.value[key]);
      check(
        localID(value.m_GameObject) === go.id,
        "GameObject 参照が一致しません。",
      );
      return { id, type: d.type, value };
    });
    const transforms = components.filter((c) => c.type === 4);
    const filters = components.filter((c) => c.type === 33);
    const renderers = components.filter((c) => c.type === 23);
    check(
      transforms.length === 1 &&
        filters.length <= 1 &&
        renderers.length === filters.length,
      "各 GameObject は Transform が一つ、MeshFilter と MeshRenderer が一組まで必要です。",
    );
    const transform = transforms[0];
    const children = list(transform.value.m_Children).map(localID);
    check(
      !children.includes(0) && new Set(children).size === children.length,
      "Prefab の子参照が重複または不正です。",
    );
    let renderer: Omit<RenderInstance, "world" | "path"> | undefined;
    if (renderers.length) {
      const materials = list(renderers[0].value.m_Materials).map(ref);
      check(
        materials.length > 0 && materials.length <= 32,
        "素材スロット数が不正です。",
      );
      renderer = {
        name: data.m_Name,
        transformID: transform.id,
        mesh: ref(filters[0].value.m_Mesh),
        materials,
      };
    }
    nodes.set(transform.id, {
      name: data.m_Name,
      children,
      parent: localID(transform.value.m_Father),
      local: localMatrix(transform.value),
      active: flag(data.m_IsActive),
      enabled: !renderers.length || flag(renderers[0].value.m_Enabled),
      renderer,
    });
  }
  check(
    docs.filter((d) => d.type !== 1).every((d) => used.has(d.id)),
    "GameObject に所属しない Prefab component があります。",
  );
  const roots = [...nodes.entries()].filter(([, node]) => node.parent === 0);
  check(
    roots.length === 1,
    "Prefab の root は一つが必要です。親参照の循環も確認してください。",
  );
  for (const [id, node] of nodes) {
    if (node.parent !== 0)
      check(
        nodes.get(node.parent)?.children.includes(id),
        "Prefab の親子参照が一致しません。",
      );
    for (const child of node.children)
      check(
        nodes.get(child)?.parent === id,
        "Prefab の親子参照が欠落または一致しません。",
      );
  }
  const visiting = new Set<number>(),
    visited = new Set<number>();
  const output: RenderInstance[] = [];
  let hidden = 0;
  function walk(
    id: number,
    parent: Matrix4,
    parentActive: boolean,
    path: string,
    depth: number,
  ) {
    check(
      depth <= LIMITS.prefabDepth && !visiting.has(id),
      "Prefab の階層が深すぎるか、親子参照が循環しています。",
    );
    const node = nodes.get(id)!;
    visiting.add(id);
    visited.add(id);
    const world = parent.clone().multiply(node.local);
    check(
      world.elements.every((n) => Number.isFinite(n) && Math.abs(n) <= 1e9) &&
        Math.abs(world.determinant()) >= 1e-12,
      "Prefab の合成 Transform が大きすぎるか、スケールが小さすぎます。",
    );
    const active = parentActive && node.active;
    const currentPath = path ? path + "/" + node.name : node.name;
    if (node.renderer) {
      if (active && node.enabled)
        output.push({ ...node.renderer, path: currentPath, world });
      else hidden++;
    }
    check(
      output.length <= LIMITS.meshes,
      "表示する部品が 32 の上限を超えています。",
    );
    for (const child of node.children)
      walk(child, world, active, currentPath, depth + 1);
    visiting.delete(id);
  }
  walk(roots[0][0], new Matrix4(), true, "", 1);
  check(
    visited.size === nodes.size,
    "Prefab に到達できないノードまたは循環があります。",
  );
  check(output.length > 0, "表示できる有効な MeshRenderer がありません。");
  if (hidden)
    warnings.push(
      `${hidden} 部品を非アクティブ／無効のため表示から除外しました。`,
    );
  return output;
}
