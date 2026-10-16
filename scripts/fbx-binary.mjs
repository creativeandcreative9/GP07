// Minimal independent FBX 7.4 fixture writer, not part of the application bundle.
import { deflateSync } from "node:zlib";

function property([type, value], compressed) {
  if (type === "S") {
    const bytes = Buffer.from(value),
      header = Buffer.alloc(5);
    header.write(type);
    header.writeUInt32LE(bytes.length, 1);
    return Buffer.concat([header, bytes]);
  }
  if (type === "d" || type === "i") {
    const size = type === "d" ? 8 : 4;
    const data = Buffer.alloc(value.length * size);
    value.forEach((n, i) =>
      type === "d"
        ? data.writeDoubleLE(n, i * size)
        : data.writeInt32LE(n, i * size),
    );
    const packed = compressed ? deflateSync(data) : data;
    const header = Buffer.alloc(13);
    header.write(type);
    header.writeUInt32LE(value.length, 1);
    header.writeUInt32LE(compressed ? 1 : 0, 5);
    header.writeUInt32LE(packed.length, 9);
    return Buffer.concat([header, packed]);
  }
  const sizes = { I: 4, L: 8, D: 8, C: 1 };
  if (!sizes[type]) throw new Error("Unsupported fixture property");
  const bytes = Buffer.alloc(1 + sizes[type]);
  bytes.write(type);
  if (type === "I") bytes.writeInt32LE(value, 1);
  if (type === "L") bytes.writeBigInt64LE(BigInt(value), 1);
  if (type === "D") bytes.writeDoubleLE(value, 1);
  if (type === "C") bytes[1] = Number(value);
  return bytes;
}

export function binaryFbx(nodes, compressed = true) {
  let offset = 27;
  function node({ name, props = [], children = [] }) {
    const start = offset,
      label = Buffer.from(name);
    const values = props.map((p) => property(p, compressed));
    const length = values.reduce((sum, p) => sum + p.length, 0);
    const header = Buffer.alloc(13);
    offset += 13 + label.length + length;
    const nested = children.map(node);
    if (children.length) {
      nested.push(Buffer.alloc(13));
      offset += 13;
    }
    header.writeUInt32LE(offset);
    header.writeUInt32LE(props.length, 4);
    header.writeUInt32LE(length, 8);
    header[12] = label.length;
    if (offset <= start) throw new Error("Fixture offset did not advance");
    return Buffer.concat([header, label, ...values, ...nested]);
  }
  const header = Buffer.from("Kaydara FBX Binary  \0\x1a\0\0\0\0\0", "binary");
  header.writeUInt32LE(7400, 23);
  return Buffer.concat([
    header,
    ...nodes.map(node),
    Buffer.alloc(13),
    Buffer.alloc(176),
  ]);
}
