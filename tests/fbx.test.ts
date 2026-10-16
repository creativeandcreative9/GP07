import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { binaryFbx } from "../scripts/fbx-binary.mjs";
import type { BinaryNode } from "../scripts/fbx-binary.mjs";
import {
  binaryFixture,
  binaryMesh,
  fixture,
  fixtureEntries,
  tar,
} from "../scripts/generate-fixture.mjs";
import { normalizeBinaryFbx } from "../src/core/fbx-binary";
import { parsePackage } from "../src/core/model";

function mutate(bytes: Uint8Array, edit: (view: DataView) => void) {
  const copy = new Uint8Array(bytes);
  edit(new DataView(copy.buffer));
  return copy;
}
const oneArray = (compressed = true) =>
  binaryFbx([{ name: "Vertices", props: [["d", [1, 2, 3]]] }], compressed);
// The independent fixture writer emits a 27-byte file header, 13-byte node
// header, eight-byte "Vertices" name, then one property. Inspect wire fields.
const prop = 27 + 13 + 8;

describe("binary FBX integration", () => {
  it.each([true, false])(
    "loads compressed=%s arrays with the same geometry and references as ASCII",
    async (compressed) => {
      const [ascii, binary] = await Promise.all([
        parsePackage(fixture()),
        parsePackage(binaryFixture(compressed)),
      ]);
      expect(binary.source).toEqual(ascii.source);
      expect(binary.materials).toEqual(ascii.materials);
      expect(binary.mesh.format).toBe("Binary FBX 7.4");
      expect(binary.vertices).toBe(9396);
      for (const key of ["positions", "normals", "uvs"] as const) {
        const a = ascii.mesh[key],
          b = binary.mesh[key];
        expect(
          Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(
            Buffer.from(b.buffer, b.byteOffset, b.byteLength),
          ),
        ).toBe(true);
      }
      expect(binary.mesh.groups).toEqual(ascii.mesh.groups);
    },
  );
  it("normalizes without changing the input and removes compression from all arrays", async () => {
    const bytes = oneArray();
    const before = new Uint8Array(bytes);
    const output = await normalizeBinaryFbx(bytes);
    expect(new DataView(output).getUint32(prop + 5, true)).toBe(0);
    expect(new DataView(output).getUint32(prop + 9, true)).toBe(24);
    expect(new DataView(output).getFloat64(prop + 13, true)).toBe(1);
    expect(Buffer.from(bytes).equals(Buffer.from(before))).toBe(true);
  });
  it("reports a malformed binary model through the package pipeline", async () => {
    const bad = mutate(binaryMesh(), (v) => v.setUint32(27, 0xffffffff, true));
    await expect(
      parsePackage(gzipSync(tar(fixtureEntries(bad)))),
    ).rejects.toThrow("境界");
  });
});

describe("binary FBX wire boundaries", () => {
  it("rejects versions with a different record layout", async () => {
    await expect(
      normalizeBinaryFbx(
        mutate(oneArray(), (v) => v.setUint32(23, 7500, true)),
      ),
    ).rejects.toThrow("7.4");
  });
  it.each([0, 26, 80])("rejects truncation at %i bytes", async (length) => {
    await expect(
      normalizeBinaryFbx(oneArray().slice(0, length)),
    ).rejects.toThrow();
  });
  it.each([10, 0xffffffff])(
    "rejects invalid node end offsets %i",
    async (offset) => {
      await expect(
        normalizeBinaryFbx(
          mutate(oneArray(), (v) => v.setUint32(27, offset, true)),
        ),
      ).rejects.toThrow("境界");
    },
  );
  it("checks property count and propertyListLen instead of trusting node offsets", async () => {
    await expect(
      normalizeBinaryFbx(
        mutate(oneArray(), (v) => v.setUint32(31, 20001, true)),
      ),
    ).rejects.toThrow("プロパティ数");
    await expect(
      normalizeBinaryFbx(mutate(oneArray(), (v) => v.setUint32(35, 1, true))),
    ).rejects.toThrow("境界");
    await expect(
      normalizeBinaryFbx(
        mutate(oneArray(), (v) => v.setUint32(35, 0xffffffff, true)),
      ),
    ).rejects.toThrow("境界");
  });
  it("rejects forged counts and compression flags before inflation", async () => {
    await expect(
      normalizeBinaryFbx(
        mutate(oneArray(), (v) => v.setUint32(prop + 1, 0xffffffff, true)),
      ),
    ).rejects.toThrow("配列が上限");
    await expect(
      normalizeBinaryFbx(
        mutate(oneArray(), (v) => v.setUint32(prop + 5, 2, true)),
      ),
    ).rejects.toThrow("圧縮方式");
    await expect(
      normalizeBinaryFbx(
        mutate(oneArray(), (v) => v.setUint32(prop + 9, 0xffffffff, true)),
      ),
    ).rejects.toThrow("境界");
  });
  it("rejects decompression expansion beyond the declared size while streaming", async () => {
    const input = binaryFbx([
      { name: "Vertices", props: [["d", Array(100_000).fill(0)]] },
    ]);
    await expect(
      normalizeBinaryFbx(mutate(input, (v) => v.setUint32(prop + 1, 1, true))),
    ).rejects.toThrow("展開長が宣言値を超え");
  });
  it("rejects short decompression and incorrect raw lengths", async () => {
    await expect(
      normalizeBinaryFbx(
        mutate(oneArray(), (v) => v.setUint32(prop + 1, 4, true)),
      ),
    ).rejects.toThrow("展開長が一致");
    await expect(
      normalizeBinaryFbx(
        mutate(oneArray(false), (v) => v.setUint32(prop + 9, 23, true)),
      ),
    ).rejects.toThrow("非圧縮配列");
  });
  it("checks zlib integrity and rejects forged raw compression flags", async () => {
    const bytes = oneArray();
    const end =
      prop +
      13 +
      new DataView(bytes.buffer, bytes.byteOffset).getUint32(prop + 9, true);
    const corrupt = new Uint8Array(bytes);
    corrupt[end - 1] ^= 1;
    await expect(normalizeBinaryFbx(corrupt)).rejects.toThrow();
    // Change the encoding to raw without changing the compressed data.
    await expect(
      normalizeBinaryFbx(mutate(bytes, (v) => v.setUint32(prop + 5, 0, true))),
    ).rejects.toThrow("非圧縮配列");
  });
  it.each([
    "Texture",
    "Video",
    "Deformer",
    "AnimationCurve",
    "__proto__",
    "constructor",
  ])("rejects disallowed node %s", async (name) => {
    await expect(normalizeBinaryFbx(binaryFbx([{ name }]))).rejects.toThrow();
  });
  it("rejects reserved property keys and non-finite numeric arrays", async () => {
    await expect(
      normalizeBinaryFbx(
        binaryFbx([{ name: "P", props: [["S", "__proto__"]] }]),
      ),
    ).rejects.toThrow("予約キー");
    await expect(
      normalizeBinaryFbx(
        binaryFbx([{ name: "Vertices", props: [["d", [NaN]]] }]),
      ),
    ).rejects.toThrow("不正な数値");
  });
  it("rejects excessive nested node records", async () => {
    let node: BinaryNode = { name: "Child", children: [] };
    for (let i = 0; i < 66; i++) node = { name: "Child", children: [node] };
    await expect(normalizeBinaryFbx(binaryFbx([node]))).rejects.toThrow(
      "構造の上限",
    );
  });
  it("rejects nontriangular polygon index arrays", async () => {
    await expect(
      normalizeBinaryFbx(
        binaryFbx([
          { name: "PolygonVertexIndex", props: [["i", [0, 1, 2, -4]]] },
        ]),
      ),
    ).rejects.toThrow("三角形");
    await expect(
      normalizeBinaryFbx(
        binaryFbx([{ name: "PolygonVertexIndex", props: [["i", [0, -2, 2]]] }]),
      ),
    ).rejects.toThrow("三角形");
  });
  it("rejects too many polygon vertices before decompression", async () => {
    const input = binaryFbx([
      { name: "PolygonVertexIndex", props: [["i", [0, 1, -3]]] },
    ]);
    const countOffset = 27 + 13 + "PolygonVertexIndex".length + 1;
    await expect(
      normalizeBinaryFbx(
        mutate(input, (v) => v.setUint32(countOffset, 500001, true)),
      ),
    ).rejects.toThrow("500,000");
  });
  it("limits aggregate array scalars across multiple compressed properties", async () => {
    const values = Array<number>(1_500_000).fill(0);
    const input = binaryFbx([
      ...["A", "B", "C"].map((name) => ({
        name,
        props: [["i", values]] as [string, number[]][],
      })),
      { name: "D", props: [["i", [1]]] },
    ]);
    await expect(normalizeBinaryFbx(input)).rejects.toThrow("配列が上限");
  });
  it("rejects unsafe 64-bit IDs and unsupported raw blobs", async () => {
    await expect(
      normalizeBinaryFbx(
        binaryFbx([
          { name: "Model", props: [["L", Number.MAX_SAFE_INTEGER + 1]] },
        ]),
      ),
    ).rejects.toThrow("安全な整数範囲");
    const input = binaryFbx([{ name: "Data", props: [["S", "blob"]] }]);
    const tag = 27 + 13 + "Data".length;
    const raw = new Uint8Array(input);
    raw[tag] = "R".charCodeAt(0);
    await expect(normalizeBinaryFbx(raw)).rejects.toThrow("プロパティ型");
  });
});
