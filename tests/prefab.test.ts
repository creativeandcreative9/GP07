import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import {
  GUID,
  fixture,
  fixtureEntries,
  hierarchyFixture,
  hierarchyNodes,
  hierarchyEntries,
  tar,
} from "../scripts/generate-fixture.mjs";
import { prefabText } from "../scripts/prefab-fixture.mjs";
import type { FixtureNode } from "../scripts/prefab-fixture.mjs";
import { parsePackage } from "../src/core/model";
import { readPrefab } from "../src/core/prefab";
import { combineParts } from "../src/core/geometry";
import type { MeshData } from "../src/core/types";

const encoder = new TextEncoder();
const body: FixtureNode = {
  name: "Body",
  mesh: { guid: GUID.mesh, fileID: 4300000 },
  materials: [GUID.body, GUID.face, GUID.accent],
};
const parse = (nodes: FixtureNode[]) =>
  readPrefab(encoder.encode(prefabText(nodes)), []);
function corrupt(change: (text: string) => string) {
  return gzipSync(
    tar(
      hierarchyEntries().map(([name, data]) => [
        name,
        name === `${GUID.prefab}/asset` ? change(String(data)) : data,
      ]),
    ),
  );
}

describe("hierarchical static package integration", () => {
  it("converts FBX centimeters to meters before applying Prefab positions", async () => {
    const scene = await parsePackage(fixture());
    let top = -Infinity;
    for (let i = 1; i < scene.mesh.positions.length; i += 3)
      top = Math.max(top, scene.mesh.positions[i]);
    expect(top).toBeCloseTo(1.98, 5);
    const meters = gzipSync(
      tar(
        fixtureEntries().map(([name, data]) => [
          name,
          name === `${GUID.mesh}/asset`
            ? String(data).replace(
                '"UnitScaleFactor", "double", "Number", "",1',
                '"UnitScaleFactor", "double", "Number", "",100',
              )
            : data,
        ]),
      ),
    );
    const enlarged = await parsePackage(meters);
    for (let i = 0; i < scene.mesh.positions.length; i += 123)
      expect(enlarged.mesh.positions[i]).toBeCloseTo(
        scene.mesh.positions[i] * 100,
        3,
      );
  });
  it("applies importer scale to geometry without scaling Prefab translation", async () => {
    const nodes = [{ ...body, position: [5, 0, 0] }];
    const scaled = gzipSync(
      tar(
        hierarchyEntries(nodes).map(([name, data]) => [
          name,
          name === `${GUID.mesh}/asset.meta`
            ? String(data).replace(
                "ModelImporter:\n",
                "ModelImporter:\n  globalScale: 2\n",
              )
            : data,
        ]),
      ),
    );
    const [base, scene] = await Promise.all([
      parsePackage(fixture()),
      parsePackage(scaled),
    ]);
    expect(scene.source.renderers[0].importScale).toBe(2);
    for (let i = 0; i < base.mesh.positions.length; i += 123)
      expect(scene.mesh.positions[i]).toBeCloseTo(
        base.mesh.positions[i] * 2 - 5,
        4,
      );
  });
  it.each(["globalScale: 0", "useFileScale: 0"])(
    "rejects unsupported importer setting %s",
    async (setting) => {
      const input = gzipSync(
        tar(
          fixtureEntries().map(([name, data]) => [
            name,
            name === `${GUID.mesh}/asset.meta`
              ? String(data).replace(
                  "ModelImporter:\n",
                  `ModelImporter:\n  ${setting}\n`,
                )
              : data,
          ]),
        ),
      );
      await expect(parsePackage(input)).rejects.toThrow("ModelImporter");
    },
  );
  it("rejects missing or invalid FBX unit declarations", async () => {
    const input = gzipSync(
      tar(
        fixtureEntries().map(([name, data]) => [
          name,
          name === `${GUID.mesh}/asset`
            ? String(data).replace(
                '"UnitScaleFactor", "double", "Number", "",1',
                '"UnitScaleFactor", "double", "Number", "",0',
              )
            : data,
        ]),
      ),
    );
    await expect(parsePackage(input)).rejects.toThrow("UnitScaleFactor");
  });
  it("resolves two FBX geometries, three instances and shared material GUIDs", async () => {
    const scene = await parsePackage(hierarchyFixture());
    expect(scene.vertices).toBe(9468);
    expect(scene.materials.map((m) => m.guid)).toEqual([
      GUID.body,
      GUID.face,
      GUID.accent,
      GUID.gold,
    ]);
    expect(scene.source.renderers.map((r) => r.path)).toEqual([
      "OrbitRig/Orbit",
      "OrbitRig/Accessories/LeftBeacon",
      "OrbitRig/Accessories/RightBeacon",
    ]);
    expect(scene.source.renderers.map((r) => r.mesh.fileID)).toEqual([
      4300000, 4300001, 4300001,
    ]);
    expect(scene.mesh.groups.slice(-2)).toEqual([
      { start: 9396, count: 36, materialIndex: 3 },
      { start: 9432, count: 36, materialIndex: 3 },
    ]);
    const left = scene.source.renderers[1].matrix;
    expect(left[12]).toBeCloseTo(
      0.15 - (0.75 * Math.cos(Math.PI / 6)) / Math.sqrt(2),
    );
    expect(left[13]).toBeCloseTo(1.2 - 0.75 / Math.sqrt(2));
    expect(left[14]).toBeCloseTo((0.75 * Math.sin(Math.PI / 6)) / Math.sqrt(2));
  });
  it("composes parent rotation/scale and child position using Unity handedness", async () => {
    const nodes = [
      {
        name: "Root",
        position: [10, 20, 30],
        rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
        scale: [2, 1, 1],
      },
      { ...body, parent: 0, position: [1, 0, 0] },
    ];
    const [base, scene] = await Promise.all([
      parsePackage(fixture()),
      parsePackage(hierarchyFixture(nodes)),
    ]);
    for (let i = 0; i < base.mesh.positions.length; i += 123) {
      const [x, y, z] = base.mesh.positions.slice(i, i + 3);
      expect(scene.mesh.positions[i]).toBeCloseTo(y - 10, 3);
      expect(scene.mesh.positions[i + 1]).toBeCloseTo(22 - 2 * x, 3);
      expect(scene.mesh.positions[i + 2]).toBeCloseTo(z + 30, 3);
      const [nx, ny, nz] = base.mesh.normals.slice(i, i + 3);
      const length = Math.hypot(ny, nx / 2, nz);
      if (length) {
        expect(scene.mesh.normals[i]).toBeCloseTo(ny / length, 5);
        expect(scene.mesh.normals[i + 1]).toBeCloseTo(-nx / 2 / length, 5);
        expect(scene.mesh.normals[i + 2]).toBeCloseTo(nz / length, 5);
      }
    }
  });
  it("reverses triangle winding and normals for mirrored instance scales", async () => {
    const [base, mirrored] = await Promise.all([
      parsePackage(fixture()),
      parsePackage(hierarchyFixture([{ ...body, scale: [-1, 1, 1] }])),
    ]);
    for (let i = 0; i < base.mesh.positions.length; i += 9) {
      for (let vertex = 0; vertex < 3; vertex++) {
        const from = i + [0, 2, 1][vertex] * 3,
          to = i + vertex * 3;
        expect(mirrored.mesh.positions[to]).toBeCloseTo(
          -base.mesh.positions[from],
          4,
        );
        expect(mirrored.mesh.positions[to + 1]).toBeCloseTo(
          base.mesh.positions[from + 1],
          4,
        );
        expect(mirrored.mesh.positions[to + 2]).toBeCloseTo(
          base.mesh.positions[from + 2],
          4,
        );
      }
    }
  });
  it("omits inactive ancestors and disabled renderers with warnings", async () => {
    const nodes = hierarchyNodes();
    nodes[2].active = false;
    const hidden = await parsePackage(hierarchyFixture(nodes));
    expect(hidden.source.renderers).toHaveLength(1);
    expect(hidden.materials).toHaveLength(3);
    expect(hidden.warnings.join()).toContain("2 部品");
    const second = hierarchyNodes();
    second[4].enabled = false;
    expect(
      (await parsePackage(hierarchyFixture(second))).source.renderers,
    ).toHaveLength(2);
  });
  it("rejects material slots and mesh fileIDs that do not resolve", async () => {
    const nodes = hierarchyNodes();
    nodes[1].materials = [GUID.body];
    await expect(parsePackage(hierarchyFixture(nodes))).rejects.toThrow(
      "素材スロット",
    );
    nodes[1].materials = body.materials;
    nodes[1].mesh!.fileID = 4300009;
    await expect(parsePackage(hierarchyFixture(nodes))).rejects.toThrow(
      "fileID",
    );
  });
  it("rejects ambiguous geometry names even when the meta fileID resolves", async () => {
    const entries = hierarchyEntries().map(([name, data]) => {
      if (name !== `${GUID.mesh}/asset`)
        return [name, data] as [string, Uint8Array | string];
      const bytes = Buffer.from(data);
      const index = bytes.indexOf("Beacon\0");
      expect(index).toBeGreaterThan(0);
      bytes.set(Buffer.from("Orbit\0"), index);
      return [name, bytes] as [string, Uint8Array];
    });
    await expect(parsePackage(gzipSync(tar(entries)))).rejects.toThrow("曖昧");
  });
});

describe("Prefab graph validation", () => {
  it.each([
    [
      "missing component",
      (s: string) =>
        s.replace("component: {fileID: 4001}", "component: {fileID: 999999}"),
    ],
    [
      "wrong owner",
      (s: string) =>
        s.replace(
          "m_GameObject: {fileID: 1001}",
          "m_GameObject: {fileID: 1000}",
        ),
    ],
    [
      "duplicate component",
      (s: string) =>
        s.replace(
          "component: {fileID: 4001}",
          "component: {fileID: 4001}\n  - component: {fileID: 4001}",
        ),
    ],
    [
      "duplicate child",
      (s: string) =>
        s.replace(
          "  - {fileID: 4001}",
          "  - {fileID: 4001}\n  - {fileID: 4001}",
        ),
    ],
    [
      "missing child",
      (s: string) => s.replace("  - {fileID: 4001}", "  - {fileID: 99999}"),
    ],
    [
      "external parent",
      (s: string) =>
        s.replace(
          "m_Father: {fileID: 4000}",
          `m_Father: {fileID: 4000, guid: ${GUID.mesh}}`,
        ),
    ],
  ])("rejects %s instead of guessing links", async (_, change) => {
    await expect(parsePackage(corrupt(change))).rejects.toThrow();
  });
  it("rejects missing parents, multiple roots and disconnected cycles", () => {
    expect(() => parse([{ name: "Root" }, { ...body, parent: 99 }])).toThrow(
      "親子参照",
    );
    expect(() => parse([body, { name: "Root2" }])).toThrow("root");
    expect(() =>
      parse([
        body,
        { name: "CycleA", parent: 2 },
        { name: "CycleB", parent: 1 },
      ]),
    ).toThrow("循環");
    expect(() =>
      parse([
        { ...body, parent: 1 },
        { name: "Cycle", parent: 0 },
      ]),
    ).toThrow("root");
  });
  it("rejects orphan and mismatched component pairs", () => {
    const source = prefabText([body]);
    const orphan =
      source + "--- !u!4 &777\nTransform:\n  m_GameObject: {fileID: 1000}\n";
    expect(() => readPrefab(encoder.encode(orphan), [])).toThrow("所属しない");
    expect(() =>
      readPrefab(
        encoder.encode(source.replace("  - component: {fileID: 33000}\n", "")),
        [],
      ),
    ).toThrow("一組");
  });
  it("accepts depth 32 and rejects depth 33 or more than 128 GameObjects", () => {
    const chain: FixtureNode[] = Array.from({ length: 32 }, (_, i) =>
      i ? { name: "Child", parent: i - 1 } : body,
    );
    expect(parse(chain)).toHaveLength(1);
    expect(() => parse([...chain, { name: "TooDeep", parent: 31 }])).toThrow(
      "階層",
    );
    expect(() =>
      parse([
        body,
        ...Array.from({ length: 128 }, () => ({ name: "Child", parent: 0 })),
      ]),
    ).toThrow("128");
  });
  it("rejects more than 32 visible mesh instances", () => {
    expect(() =>
      parse([
        body,
        ...Array.from({ length: 32 }, () => ({ ...body, parent: 0 })),
      ]),
    ).toThrow("32");
  });
  it.each([
    { scale: [0, 1, 1] },
    { scale: [1001, 1, 1] },
    { position: [1e7, 0, 0] },
    { rotation: [0, 0, 0, 0] },
    { rotation: [0, 0, 0, 2] },
  ])("rejects invalid local transform %j", (transform) =>
    expect(() => parse([{ ...body, ...transform }])).toThrow(),
  );
  it("rejects excessive composed transforms and all-hidden scenes", () => {
    expect(() =>
      parse([
        { name: "Root", scale: [1000, 1000, 1000], position: [1e6, 0, 0] },
        { ...body, parent: 0, position: [1e6, 0, 0] },
      ]),
    ).toThrow("合成");
    expect(() => parse([{ ...body, active: false }])).toThrow(
      "有効な MeshRenderer",
    );
  });
  it("enforces aggregate vertex limits before allocating combined output", () => {
    const mesh: MeshData = {
      name: "synthetic budget test",
      format: "test",
      positions: new Float32Array(250002 * 3),
      normals: new Float32Array(),
      uvs: new Float32Array(),
      groups: [],
    };
    expect(() =>
      combineParts([
        { mesh, slots: [0] },
        { mesh, slots: [0] },
      ]),
    ).toThrow("合計頂点数");
  });
});
