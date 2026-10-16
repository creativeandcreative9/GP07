import { check, LIMITS, text } from "./types";
import type { Asset } from "./types";

export function safePath(value: string): string {
  check(value.length > 0 && value.length <= 512, "パスの長さが不正です。");
  check(
    !/[\\:]/u.test(value) &&
      [...value].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127),
    "危険なパス文字を検出しました。",
  );
  const path = value.normalize("NFC");
  check(
    !path.startsWith("/") &&
      path
        .split("/")
        .every((s) => s !== "" && s !== "." && s !== ".." && !/[. ]$/.test(s)),
    "絶対パス・相対移動・曖昧なパスを拒否しました。",
  );
  return path;
}

class StreamReader {
  private pending: Uint8Array = new Uint8Array(0);
  private total = 0;
  constructor(
    private reader: ReadableStreamDefaultReader<Uint8Array>,
    private budget: number,
  ) {}
  async read(size: number): Promise<Uint8Array | null> {
    const out = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
      if (!this.pending.length) {
        const { done, value } = await this.reader.read();
        if (done) {
          check(offset === 0, "tar が途中で切れています。");
          return null;
        }
        this.total += value.length;
        check(
          this.total <= this.budget,
          "展開合計が 128 MiB の上限を超えています。",
        );
        this.pending = value;
      }
      const count = Math.min(size - offset, this.pending.length);
      out.set(this.pending.subarray(0, count), offset);
      this.pending = this.pending.subarray(count);
      offset += count;
    }
    return out;
  }
}

function field(block: Uint8Array, start: number, size: number): string {
  const part = block.subarray(start, start + size);
  const end = part.indexOf(0);
  if (end >= 0)
    check(
      part.subarray(end).every((n) => n === 0),
      "tar ヘッダー内の NUL が不正です。",
    );
  return new TextDecoder("utf-8", { fatal: true }).decode(
    end < 0 ? part : part.subarray(0, end),
  );
}
function octal(block: Uint8Array, start: number, size: number): number {
  const raw = new TextDecoder().decode(block.subarray(start, start + size));
  let end = raw.length;
  while (end > 0 && (raw.charCodeAt(end - 1) === 0 || raw[end - 1] === " "))
    end--;
  const value = raw.slice(0, end).trim();
  check(/^[0-7]+$/.test(value), "tar 数値フィールドが不正です。");
  return Number.parseInt(value, 8);
}

export async function unpack(
  input: Uint8Array,
  budget: number = LIMITS.expanded,
): Promise<Map<string, Uint8Array>> {
  check(input.length <= LIMITS.input, "入力が 32 MiB の上限を超えています。");
  check(
    input[0] === 0x1f && input[1] === 0x8b && input[2] === 8,
    "gzip 形式の unitypackage を選択してください。",
  );
  const stream = new Blob([new Uint8Array(input).buffer])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const r = new StreamReader(reader, budget);
  const files = new Map<string, Uint8Array>();
  const seen = new Set<string>();
  let entries = 0;
  try {
    while (true) {
      const header = await r.read(512);
      check(header, "tar 終端がありません。");
      if (header.every((n) => n === 0)) {
        const second = await r.read(512);
        check(
          second?.every((n) => n === 0),
          "tar 終端が不正です。",
        );
        // Drain the gzip stream to check its CRC/trailer and reject appended archives.
        while (true) {
          const padding = await r.read(512);
          if (!padding) break;
          check(
            padding.every((n) => n === 0),
            "tar 終端後にデータがあります。",
          );
        }
        break;
      }
      check(
        ++entries <= LIMITS.entries,
        "tar entry が 2,000 件の上限を超えています。",
      );
      let sum = 0;
      for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
      check(sum === octal(header, 148, 8), "tar チェックサムが一致しません。");
      const prefix = field(header, 345, 155);
      const raw = (prefix ? prefix + "/" : "") + field(header, 0, 100);
      const dir = header[156] === 53;
      check(
        dir || header[156] === 0 || header[156] === 48,
        "リンク・特殊 tar entry は読み込めません。",
      );
      const name = safePath(dir && raw.endsWith("/") ? raw.slice(0, -1) : raw);
      const key = name.toLowerCase();
      check(!seen.has(key), "重複・正規化衝突する tar entry があります。");
      seen.add(key);
      check(
        dir
          ? /^[a-f0-9]{32}$/i.test(name)
          : /^[a-f0-9]{32}\/(asset|asset\.meta|pathname|preview\.png)$/i.test(
              name,
            ),
        "unitypackage 外の entry を拒否しました。",
      );
      const size = octal(header, 124, 12);
      check(
        size <= LIMITS.file && (!dir || size === 0),
        "単体ファイルサイズが不正または 32 MiB 超です。",
      );
      const data = size ? await r.read(size) : new Uint8Array();
      check(data, "tar asset が途中で切れています。");
      if (!dir) files.set(name.toLowerCase(), data);
      const padding = (512 - (size % 512)) % 512;
      if (padding) check(await r.read(padding), "tar padding がありません。");
    }
    return files;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function indexAssets(files: Map<string, Uint8Array>): Asset[] {
  const guids = new Set([...files.keys()].map((name) => name.split("/")[0]));
  const paths = new Set<string>();
  return [...guids].map((guid) => {
    const pathname = files.get(guid + "/pathname");
    const data = files.get(guid + "/asset");
    const meta = files.get(guid + "/asset.meta");
    check(
      pathname && data && meta,
      "pathname・asset・asset.meta が揃っていません。",
    );
    const raw = text(pathname);
    const path = safePath(raw.replace(/\r?\n$/, ""));
    check(
      path.startsWith("Assets/"),
      "Assets/ 以外の pathname は読み込めません。",
    );
    check(
      !paths.has(path.toLowerCase()),
      "重複・正規化衝突する pathname があります。",
    );
    paths.add(path.toLowerCase());
    return { guid, path, data, meta };
  });
}
