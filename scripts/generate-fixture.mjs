// Original GP07 fixture. No third-party model or texture is used.
import { BoxGeometry, SphereGeometry, CylinderGeometry, Matrix4 } from "three";
import { gzipSync, deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { binaryFbx } from "./fbx-binary.mjs";
import { prefabText } from "./prefab-fixture.mjs";

export const GUID = {
  mesh: "a1000000000000000000000000000001",
  body: "b1000000000000000000000000000001",
  face: "b2000000000000000000000000000002",
  accent: "b3000000000000000000000000000003",
  texture: "c1000000000000000000000000000001",
  prefab: "d1000000000000000000000000000001",
  gold: "b4000000000000000000000000000004",
};
const vertices = [],
  normals = [],
  uvs = [],
  indices = [],
  materials = [];
function part(geometry, x, y, z, sx, sy, sz, material) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.applyMatrix4(new Matrix4().makeScale(sx, sy, sz));
  g.translate(x, y, z);
  const p = g.getAttribute("position"),
    n = g.getAttribute("normal"),
    uv = g.getAttribute("uv");
  for (let i = 0; i < p.count; i++) {
    vertices.push(p.getX(i), p.getY(i), p.getZ(i));
    normals.push(n.getX(i), n.getY(i), n.getZ(i));
    uvs.push(uv.getX(i), uv.getY(i));
    const index = indices.length;
    indices.push(i % 3 === 2 ? -index - 1 : index);
    if (i % 3 === 0) materials.push(material);
  }
  g.dispose();
  geometry.dispose();
}
// Small Y-up robot, in centimetres; separate face/eyes/boots are material groups.
part(new SphereGeometry(1, 20, 14), 0, 132, 0, 40, 37, 32, 0);
part(new SphereGeometry(1, 20, 12), 0, 135, 26, 29, 21, 12, 1);
part(new SphereGeometry(1, 12, 8), -12, 138, 37, 3, 5, 2, 2);
part(new SphereGeometry(1, 12, 8), 12, 138, 37, 3, 5, 2, 2);
part(new SphereGeometry(1, 16, 12), 0, 77, 0, 30, 34, 25, 0);
part(new SphereGeometry(1, 12, 8), 0, 80, 23, 10, 10, 4, 1);
part(new BoxGeometry(1, 1, 1), 0, 80, 28, 5, 9, 2, 2);
for (const side of [-1, 1]) {
  part(new SphereGeometry(1, 12, 8), side * 40, 82, 0, 12, 25, 12, 0);
  part(new SphereGeometry(1, 12, 8), side * 42, 59, 0, 13, 12, 13, 1);
  part(new CylinderGeometry(1, 1, 1, 12), side * 16, 30, 0, 10, 28, 10, 0);
  part(new SphereGeometry(1, 12, 8), side * 16, 12, 6, 15, 11, 21, 2);
}
part(new CylinderGeometry(1, 1, 1, 8), 0, 178, 0, 3, 19, 3, 2);
part(new SphereGeometry(1, 12, 8), 0, 191, 0, 7, 7, 7, 1);

const values = (a) => a.map((n) => Number(n.toFixed(6))).join(",");
const array = (key, a, tabs = 2) =>
  `${"\t".repeat(tabs)}${key}: *${a.length} {\n${"\t".repeat(tabs + 1)}a: ${values(a)}\n${"\t".repeat(tabs)}}`;
export const fbx = `; FBX 7.4.0 project file
; ${"-".repeat(220)}
; GP07 original fixture
FBXHeaderExtension:  {
\tFBXHeaderVersion: 1003
\tFBXVersion: 7400
}
GlobalSettings:  {
\tVersion: 1000
\tProperties70:  {
\t\tP: "UpAxis", "int", "Integer", "",1
\t\tP: "UpAxisSign", "int", "Integer", "",1
\t\tP: "UnitScaleFactor", "double", "Number", "",1
\t}
}
Objects:  {
\tGeometry: 100, "Geometry::Orbit", "Mesh" {
${array("Vertices", vertices)}
${array("PolygonVertexIndex", indices)}
\t\tLayerElementNormal: 0 {
\t\t\tVersion: 101
\t\t\tName: ""
\t\t\tMappingInformationType: "ByPolygonVertex"
\t\t\tReferenceInformationType: "Direct"
${array("Normals", normals, 3)}
\t\t}
\t\tLayerElementUV: 0 {
\t\t\tVersion: 101
\t\t\tName: "UVChannel_1"
\t\t\tMappingInformationType: "ByPolygonVertex"
\t\t\tReferenceInformationType: "Direct"
${array("UV", uvs, 3)}
\t\t}
\t\tLayerElementMaterial: 0 {
\t\t\tVersion: 101
\t\t\tName: ""
\t\t\tMappingInformationType: "ByPolygon"
\t\t\tReferenceInformationType: "IndexToDirect"
${array("Materials", materials, 3)}
\t\t}
\t}
\tModel: 200, "Model::Orbit", "Mesh" {
\t\tVersion: 232
\t\tProperties70:  {
\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
\t\t\tP: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
\t\t\tP: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
\t\t}
\t\tShading: T
\t\tCulling: "CullingOff"
\t}
${[0, 1, 2].map((i) => `\tMaterial: ${300 + i}, "Material::Slot${i}", "" {\n\t\tVersion: 102\n\t\tShadingModel: "phong"\n\t\tProperties70:  {\n\t\t\tP: "DiffuseColor", "Color", "", "A",1,1,1\n\t\t}\n\t}`).join("\n")}
}
Connections:  {
\tC: "OO",100,200
\tC: "OO",200,0
\tC: "OO",300,200
\tC: "OO",301,200
\tC: "OO",302,200
}
`;

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type),
    len = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([len, name, data, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(8);
ihdr.writeUInt32BE(8, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const pixels = [];
for (let y = 0; y < 8; y++) {
  pixels.push(0);
  for (let x = 0; x < 8; x++)
    pixels.push(...((x + y) % 2 ? [255, 255, 255] : [227, 218, 245]));
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(Buffer.from(pixels))),
  chunk("IEND", Buffer.alloc(0)),
]);
const header = "%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n";
function material(name, rgb, texture = false) {
  return `${header}--- !u!21 &2100000
Material:
  serializedVersion: 8
  m_Name: ${name}
  m_Shader: {fileID: 4800000, guid: efa77a80ca0344749b4f19fdd5891cbe, type: 3}
  m_ValidKeywords: []
  m_SavedProperties:
    serializedVersion: 3
    m_TexEnvs:
    - _MainTex:
        m_Texture: {fileID: ${texture ? `2800000, guid: ${GUID.texture}, type: 3` : "0"}}
        m_Scale: {x: 1, y: 1}
        m_Offset: {x: 0, y: 0}
    m_Floats:
    - _UseShadow: 1
    - _ShadowBorder: 0.5
    - _OutlineWidth: 0.08
    m_Colors:
    - _Color: {r: ${rgb[0]}, g: ${rgb[1]}, b: ${rgb[2]}, a: 1}
    - _ShadowColor: {r: 0.63, g: 0.58, b: 0.76, a: 1}
    - _OutlineColor: {r: 0.12, g: 0.1, b: 0.19, a: 1}
`;
}
const prefab = `${header}--- !u!1 &1000
GameObject:
  m_Name: Orbit
  m_Component:
  - component: {fileID: 4000}
  - component: {fileID: 33000}
  - component: {fileID: 23000}
--- !u!4 &4000
Transform:
  m_GameObject: {fileID: 1000}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Father: {fileID: 0}
  m_Children: []
--- !u!33 &33000
MeshFilter:
  m_GameObject: {fileID: 1000}
  m_Mesh: {fileID: 4300000, guid: ${GUID.mesh}, type: 3}
--- !u!23 &23000
MeshRenderer:
  m_GameObject: {fileID: 1000}
  m_Materials:
${[GUID.body, GUID.face, GUID.accent].map((g) => `  - {fileID: 2100000, guid: ${g}, type: 2}`).join("\n")}
`;

export function tar(entries) {
  const blocks = [];
  for (const [path, input, type = "0"] of entries) {
    const data = Buffer.from(input),
      h = Buffer.alloc(512);
    h.write(path, 0, 100);
    h.write("0000644\0", 100);
    h.write("0000000\0", 108);
    h.write("0000000\0", 116);
    h.write(data.length.toString(8).padStart(11, "0") + "\0", 124);
    h.write("00000000000\0", 136);
    h.fill(32, 148, 156);
    h.write(type, 156);
    h.write("ustar\0", 257);
    h.write("00", 263);
    const checksum = h.reduce((a, b) => a + b, 0);
    h.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
export function fixtureEntries(meshData = fbx) {
  const assets = [
    [
      GUID.mesh,
      "Orbit.fbx",
      meshData,
      `ModelImporter:\n  internalIDToNameTable:\n  - first: {43: 4300000}\n    second: Orbit\n`,
    ],
    [
      GUID.body,
      "Body.mat",
      material("Lavender shell", [0.64, 0.51, 0.86], true),
      "NativeFormatImporter: {}\n",
    ],
    [
      GUID.face,
      "Face.mat",
      material("Porcelain", [0.96, 0.94, 1]),
      "NativeFormatImporter: {}\n",
    ],
    [
      GUID.accent,
      "Accent.mat",
      material("Deep plum", [0.19, 0.15, 0.29]),
      "NativeFormatImporter: {}\n",
    ],
    [GUID.texture, "Weave.png", png, "TextureImporter: {}\n"],
    [GUID.prefab, "Orbit.prefab", prefab, "PrefabImporter: {}\n"],
  ];
  return assets.flatMap(([guid, name, data, importer]) => [
    [`${guid}/pathname`, `Assets/GP07/${name}\n`],
    [`${guid}/asset`, data],
    [`${guid}/asset.meta`, `fileFormatVersion: 2\nguid: ${guid}\n${importer}`],
  ]);
}
export function fixture() {
  return gzipSync(tar(fixtureEntries()), { level: 9 });
}

export function binaryMesh(compressed = true, extra = false) {
  const n = (name, props = [], children = []) => ({ name, props, children });
  const s = (value) => ["S", value];
  const i = (value) => ["I", value];
  const d = (value) => ["D", value];
  const l = (value) => ["L", value];
  const p = (name, type, values) =>
    n("P", [s(name), s(type), s(""), s("A"), ...values.map(d)]);
  const layer = (name, mapping, dataName, data, type) =>
    n(
      name,
      [i(0)],
      [
        n("Version", [i(101)]),
        n("Name", [s("")]),
        n("MappingInformationType", [s(mapping)]),
        n("ReferenceInformationType", [
          s(name === "LayerElementMaterial" ? "IndexToDirect" : "Direct"),
        ]),
        n(dataName, [[type, data]]),
      ],
    );
  // The same six-decimal values as the ASCII fixture, for exact geometry comparison.
  const rounded = (values) => values.map((v) => Number(v.toFixed(6)));
  const box = new BoxGeometry(30, 30, 30).toNonIndexed();
  const bp = Array.from(box.getAttribute("position").array);
  const bn = Array.from(box.getAttribute("normal").array);
  const bu = Array.from(box.getAttribute("uv").array);
  const bi = Array.from({ length: bp.length / 3 }, (_, k) =>
    k % 3 === 2 ? -k - 1 : k,
  );
  box.dispose();
  return binaryFbx(
    [
      n(
        "FBXHeaderExtension",
        [],
        [n("FBXHeaderVersion", [i(1003)]), n("FBXVersion", [i(7400)])],
      ),
      n(
        "GlobalSettings",
        [],
        [
          n("Version", [i(1000)]),
          n(
            "Properties70",
            [],
            [
              p("UpAxis", "int", [1]),
              p("UpAxisSign", "int", [1]),
              p("UnitScaleFactor", "double", [1]),
            ],
          ),
        ],
      ),
      n(
        "Objects",
        [],
        [
          n(
            "Geometry",
            [l(100), s("Orbit\0\x01Geometry"), s("Mesh")],
            [
              n("Vertices", [["d", rounded(vertices)]]),
              n("PolygonVertexIndex", [["i", indices]]),
              layer(
                "LayerElementNormal",
                "ByPolygonVertex",
                "Normals",
                rounded(normals),
                "d",
              ),
              layer(
                "LayerElementUV",
                "ByPolygonVertex",
                "UV",
                rounded(uvs),
                "d",
              ),
              layer(
                "LayerElementMaterial",
                "ByPolygon",
                "Materials",
                materials,
                "i",
              ),
            ],
          ),
          n(
            "Model",
            [l(200), s("Orbit\0\x01Model"), s("Mesh")],
            [
              n("Version", [i(232)]),
              n(
                "Properties70",
                [],
                [
                  p("Lcl Translation", "Lcl Translation", [0, 0, 0]),
                  p("Lcl Rotation", "Lcl Rotation", [0, 0, 0]),
                  p("Lcl Scaling", "Lcl Scaling", [1, 1, 1]),
                ],
              ),
              n("Shading", [["C", 1]]),
              n("Culling", [s("CullingOff")]),
            ],
          ),
          ...(extra
            ? [
                n(
                  "Geometry",
                  [l(101), s("Beacon\0\x01Geometry"), s("Mesh")],
                  [
                    n("Vertices", [["d", bp]]),
                    n("PolygonVertexIndex", [["i", bi]]),
                    layer(
                      "LayerElementNormal",
                      "ByPolygonVertex",
                      "Normals",
                      bn,
                      "d",
                    ),
                    layer("LayerElementUV", "ByPolygonVertex", "UV", bu, "d"),
                    layer(
                      "LayerElementMaterial",
                      "ByPolygon",
                      "Materials",
                      Array(bi.length / 3).fill(0),
                      "i",
                    ),
                  ],
                ),
                n(
                  "Model",
                  [l(201), s("Beacon\0\x01Model"), s("Mesh")],
                  [
                    n("Version", [i(232)]),
                    n(
                      "Properties70",
                      [],
                      [
                        p("Lcl Translation", "Lcl Translation", [0, 0, 0]),
                        p("Lcl Rotation", "Lcl Rotation", [0, 0, 0]),
                        p("Lcl Scaling", "Lcl Scaling", [1, 1, 1]),
                      ],
                    ),
                  ],
                ),
              ]
            : []),
          ...[0, 1, 2].map((slot) =>
            n(
              "Material",
              [l(300 + slot), s(`Slot${slot}\0\x01Material`), s("")],
              [
                n("Version", [i(102)]),
                n("ShadingModel", [s("phong")]),
                n("Properties70", [], [p("DiffuseColor", "Color", [1, 1, 1])]),
              ],
            ),
          ),
        ],
      ),
      n(
        "Connections",
        [],
        [
          [100, 200],
          [200, 0],
          [300, 200],
          [301, 200],
          [302, 200],
          ...(extra
            ? [
                [101, 201],
                [201, 0],
                [300, 201],
              ]
            : []),
        ].map(([a, b]) => n("C", [s("OO"), l(a), l(b)])),
      ),
    ],
    compressed,
  );
}

export function binaryFixture(compressed = true) {
  return gzipSync(tar(fixtureEntries(binaryMesh(compressed))), { level: 9 });
}

export function hierarchyNodes() {
  return [
    {
      name: "OrbitRig",
      position: [0.15, 0, 0],
      rotation: [0, Math.sin(Math.PI / 12), 0, Math.cos(Math.PI / 12)],
    },
    {
      name: "Orbit",
      parent: 0,
      mesh: { guid: GUID.mesh, fileID: 4300000 },
      materials: [GUID.body, GUID.face, GUID.accent],
    },
    {
      name: "Accessories",
      parent: 0,
      position: [0, 1.2, 0],
      rotation: [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)],
    },
    {
      name: "LeftBeacon",
      parent: 2,
      position: [-0.75, 0, 0],
      scale: [0.65, 1.1, 0.65],
      mesh: { guid: GUID.mesh, fileID: 4300001 },
      materials: [GUID.gold],
    },
    {
      name: "RightBeacon",
      parent: 2,
      position: [0.75, 0, 0],
      scale: [-0.65, 1.1, 0.65],
      mesh: { guid: GUID.mesh, fileID: 4300001 },
      materials: [GUID.gold],
    },
  ];
}

export function hierarchyEntries(nodes = hierarchyNodes()) {
  const entries = fixtureEntries(binaryMesh(true, true)).map(([name, data]) => [
    name,
    name === `${GUID.prefab}/asset`
      ? prefabText(nodes)
      : name === `${GUID.mesh}/asset.meta`
        ? String(data) + "  - first: {43: 4300001}\n    second: Beacon\n"
        : data,
  ]);
  return [
    ...entries,
    [`${GUID.gold}/pathname`, "Assets/GP07/Gold.mat\n"],
    [`${GUID.gold}/asset`, material("Beacon gold", [1, 0.64, 0.15])],
    [
      `${GUID.gold}/asset.meta`,
      `fileFormatVersion: 2\nguid: ${GUID.gold}\nNativeFormatImporter: {}\n`,
    ],
  ];
}
export function hierarchyFixture(nodes = hierarchyNodes()) {
  return gzipSync(tar(hierarchyEntries(nodes)), { level: 9 });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = new URL("../public/fixtures/", import.meta.url);
  await mkdir(dir, { recursive: true });
  const bytes = fixture();
  await writeFile(new URL("orbit.unitypackage", dir), bytes);
  console.log(`Generated original Orbit fixture: ${bytes.length} bytes`);
  const binary = binaryFixture();
  await writeFile(new URL("orbit-binary.unitypackage", dir), binary);
  console.log(
    `Generated original binary Orbit fixture: ${binary.length} bytes`,
  );
  const hierarchy = hierarchyFixture();
  await writeFile(new URL("orbit-hierarchy.unitypackage", dir), hierarchy);
  console.log(
    `Generated original hierarchy fixture: ${hierarchy.length} bytes`,
  );
}
