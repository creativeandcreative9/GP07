export const LIMITS = {
  input: 32 * 1024 ** 2,
  expanded: 128 * 1024 ** 2,
  entries: 2000,
  file: 32 * 1024 ** 2,
  text: 1024 ** 2,
  vertices: 500_000,
  indices: 1_500_000,
  fbx: 16 * 1024 ** 2,
  fbxExpanded: 64 * 1024 ** 2,
  fbxScalars: 4_500_000,
  meshes: 32,
  prefabNodes: 128,
  prefabDepth: 32,
  materials: 128,
  imageSide: 4096,
  pixels: 32_000_000,
  timeout: 15_000,
} as const;

export interface Asset {
  guid: string;
  path: string;
  data: Uint8Array;
  meta: Uint8Array;
}
export interface Ref {
  fileID: number;
  guid?: string;
  type?: number;
}
export interface MaterialInfo {
  name: string;
  guid: string;
  supported: boolean;
  color: [number, number, number];
  shadow: [number, number, number];
  border: number;
  outline: number;
  outlineColor: [number, number, number];
  textureGuid?: string;
  scale: [number, number];
  offset: [number, number];
}
export interface MeshData {
  name: string;
  format: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  groups: { start: number; count: number; materialIndex: number }[];
}
export interface SceneData {
  mesh: MeshData;
  materials: MaterialInfo[];
  textures: { guid: string; bytes: Uint8Array; mime: string }[];
  warnings: string[];
  assets: { guid: string; path: string; bytes: number }[];
  source: {
    prefab: string;
    renderers: {
      name: string;
      path: string;
      meshName: string;
      mesh: Ref;
      materials: Ref[];
      transformID: number;
      matrix: number[];
      importScale: number;
    }[];
  };
  vertices: number;
}
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function text(bytes: Uint8Array): string {
  check(bytes.length <= LIMITS.text, "テキストが 1 MiB の上限を超えています。");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
