declare module "*.mjs" {
  export const GUID: Record<string, string>;
  export function fixture(): Uint8Array;
  export function fixtureEntries(): [string, Uint8Array | string, string?][];
  export function tar(
    entries: [string, Uint8Array | string, string?][],
  ): Uint8Array;
}
