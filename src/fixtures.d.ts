declare module "*.mjs" {
  export const GUID: Record<string, string>;
  export function fixture(): Uint8Array;
  export function fixtureEntries(
    meshData?: Uint8Array | string,
  ): [string, Uint8Array | string, string?][];
  export function binaryMesh(compressed?: boolean, extra?: boolean): Uint8Array;
  export function binaryFixture(compressed?: boolean): Uint8Array;
  export interface FixtureNode {
    name?: string;
    parent?: number;
    position?: number[];
    rotation?: number[];
    scale?: number[];
    mesh?: { guid: string; fileID: number };
    materials?: string[];
    active?: boolean;
    enabled?: boolean;
  }
  export function prefabText(nodes: FixtureNode[]): string;
  export function hierarchyNodes(): FixtureNode[];
  export function hierarchyEntries(
    nodes?: FixtureNode[],
  ): [string, Uint8Array | string, string?][];
  export function hierarchyFixture(nodes?: FixtureNode[]): Uint8Array;
  export interface BinaryNode {
    name: string;
    props?: [string, number | string | number[]][];
    children?: BinaryNode[];
  }
  export function binaryFbx(
    nodes: BinaryNode[],
    compressed?: boolean,
  ): Uint8Array;
  export function tar(
    entries: [string, Uint8Array | string, string?][],
  ): Uint8Array;
}
