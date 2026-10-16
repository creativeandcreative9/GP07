import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import {
  fixture,
  fixtureEntries,
  GUID,
  tar,
} from "../scripts/generate-fixture.mjs";
import { indexAssets, safePath, unpack } from "../src/core/archive";
import { parsePackage } from "../src/core/model";
import { yaml } from "../src/core/unity";
import { imageInfo } from "../src/core/image";

function modified(find: string, change: (value: string) => string) {
  return gzipSync(
    tar(
      fixtureEntries().map(([name, data]) => [
        name,
        name === find ? change(String(data)) : data,
      ]),
    ),
  );
}

describe("original unitypackage integration", () => {
  it("resolves GUID, mesh fileID, material slots and texture through the real FBX loader", async () => {
    const scene = await parsePackage(fixture());
    expect(scene.source.mesh).toEqual({ guid: GUID.mesh, fileID: 4300000 });
    expect(scene.source.materials.map((r) => r.guid)).toEqual([
      GUID.body,
      GUID.face,
      GUID.accent,
    ]);
    expect(scene.materials.map((m) => m.supported)).toEqual([true, true, true]);
    expect(scene.textures[0].guid).toBe(GUID.texture);
    expect(scene.mesh.groups.map((g) => g.materialIndex)).toContain(2);
    expect(scene.vertices).toBeGreaterThan(1000);
  });
  it("rejects missing mesh references", async () => {
    await expect(
      parsePackage(
        modified(`${GUID.prefab}/asset`, (s) =>
          s.replace(GUID.mesh, "ffffffffffffffffffffffffffffffff"),
        ),
      ),
    ).rejects.toThrow("参照先");
  });
  it("rejects ambiguous fileIDs rather than guessing by name", async () => {
    await expect(
      parsePackage(
        modified(
          `${GUID.mesh}/asset.meta`,
          (s) => s + "  - first: {43: 4300000}\n    second: Other\n",
        ),
      ),
    ).rejects.toThrow("曖昧");
  });
  it("warns about unknown shaders and unsupported properties", async () => {
    const scene = await parsePackage(
      modified(`${GUID.body}/asset`, (s) =>
        s
          .replace(
            "efa77a80ca0344749b4f19fdd5891cbe",
            "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          )
          .replace(
            "    - _UseShadow: 1",
            "    - _RimEnable: 1\n    - _UseShadow: 1",
          ),
      ),
    );
    expect(scene.materials[0].supported).toBe(false);
    expect(scene.warnings.join()).toContain("未知のシェーダー");
    expect(scene.warnings.join()).toContain("_RimEnable");
  });
  it("rejects FBX embedded/external textures before loading", async () => {
    await expect(
      parsePackage(
        modified(`${GUID.mesh}/asset`, (s) =>
          s.replace(
            "Objects:  {",
            'Objects:  {\n\tTexture: 900, "Texture::evil", "" {}',
          ),
        ),
      ),
    ).rejects.toThrow("外部画像");
  });
  it("rejects non-identity prefab transforms explicitly", async () => {
    await expect(
      parsePackage(
        modified(`${GUID.prefab}/asset`, (s) =>
          s.replace("m_LocalScale: {x: 1", "m_LocalScale: {x: 2"),
        ),
      ),
    ).rejects.toThrow("Transform");
  });
});

describe("archive boundaries", () => {
  it.each([
    "../escape",
    "/root",
    "C:/file",
    "a\\b",
    "Assets/../x",
    "Assets/x\0.png",
    "Assets/a.",
    "Assets//a",
  ])("rejects unsafe path %j", (p) => expect(() => safePath(p)).toThrow());
  it("rejects special entries and duplicate entries", async () => {
    await expect(
      unpack(gzipSync(tar([[`${GUID.mesh}/asset`, "", "2"]]))),
    ).rejects.toThrow("特殊");
    await expect(
      unpack(
        gzipSync(
          tar([
            [`${GUID.mesh}/asset`, ""],
            [`${GUID.mesh}/asset`, ""],
          ]),
        ),
      ),
    ).rejects.toThrow("重複");
  });
  it("rejects bad header checksums and corrupted gzip trailer", async () => {
    const raw = tar([[`${GUID.mesh}/asset`, "hello"]]);
    raw[0] ^= 1;
    await expect(unpack(gzipSync(raw))).rejects.toThrow("チェックサム");
    const gz = fixture().slice();
    gz[gz.length - 8] ^= 1;
    await expect(unpack(gz)).rejects.toThrow();
  });
  it("enforces streaming expansion, entry and single-file limits", async () => {
    await expect(
      unpack(gzipSync(tar([[`${GUID.mesh}/asset`, "x".repeat(8192)]])), 4096),
    ).rejects.toThrow("展開合計");
    const entries: [string, string][] = Array.from({ length: 2001 }, (_, i) => [
      i.toString(16).padStart(32, "0") + "/asset",
      "",
    ]);
    await expect(unpack(gzipSync(tar(entries)))).rejects.toThrow("2,000");
    const raw = tar([[`${GUID.mesh}/asset`, ""]]);
    raw.set(
      new TextEncoder().encode(
        (33 * 1024 ** 2).toString(8).padStart(11, "0") + "\0",
      ),
      124,
    );
    raw.fill(32, 148, 156);
    const sum = raw.subarray(0, 512).reduce((a, b) => a + b, 0);
    raw.set(
      new TextEncoder().encode(sum.toString(8).padStart(6, "0") + "\0 "),
      148,
    );
    await expect(unpack(gzipSync(raw))).rejects.toThrow("32 MiB");
  });
  it("rejects truncated and appended archives", async () => {
    await expect(
      unpack(gzipSync(tar([[`${GUID.mesh}/asset`, "a"]]).slice(0, 700))),
    ).rejects.toThrow("途中");
    await expect(
      unpack(
        gzipSync(
          new Uint8Array([...tar([]), ...tar([[`${GUID.mesh}/asset`, "x"]])]),
        ),
      ),
    ).rejects.toThrow("終端後");
  });
  it("rejects duplicate pathnames and mismatched GUID metadata", async () => {
    const files = await unpack(fixture());
    files.set(`${GUID.face}/pathname`, files.get(`${GUID.body}/pathname`)!);
    expect(() => indexAssets(files)).toThrow("pathname");
    await expect(
      parsePackage(
        modified(`${GUID.body}/asset.meta`, (s) =>
          s.replace(GUID.body, GUID.face),
        ),
      ),
    ).rejects.toThrow("GUID");
  });
});

describe("untrusted data", () => {
  it.each([
    "x: &a [1]\ny: *a",
    "x: !!js/function hi",
    "x: !custom hello",
    "x: 1\nx: 2",
    "x: " + "[".repeat(40) + "1" + "]".repeat(40),
  ])("rejects unsafe or excessive YAML", (source) =>
    expect(() => yaml(source)).toThrow(),
  );
  it("rejects oversized images before decoding", () => {
    const bytes = new Uint8Array(33);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const v = new DataView(bytes.buffer);
    v.setUint32(8, 13);
    bytes.set([73, 72, 68, 82], 12);
    v.setUint32(16, 4097);
    v.setUint32(20, 8);
    expect(() => imageInfo(bytes)).toThrow("4096");
  });
});
