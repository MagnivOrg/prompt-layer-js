import { inflateRawSync } from "node:zlib";

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY = 0x02014b50;

export type ZipEntries = Record<string, Uint8Array>;

/**
 * Minimal ZIP reader supporting stored and deflated local-file entries.
 * Intended for small skill archives, not general-purpose unzipping.
 */
export const readZipEntries = (buffer: Uint8Array): ZipEntries => {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const entries: ZipEntries = {};
  let offset = 0;

  while (offset + 4 <= buffer.length) {
    const signature = view.getUint32(offset, true);
    if (signature === CENTRAL_DIRECTORY) break;
    if (signature !== LOCAL_FILE_HEADER) {
      throw new Error(
        `Unsupported ZIP structure at offset ${offset} (signature 0x${signature.toString(16)})`
      );
    }

    const compression = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > buffer.length) {
      throw new Error("ZIP entry extends past end of buffer");
    }

    const name = new TextDecoder("utf-8").decode(buffer.subarray(nameStart, nameEnd));
    offset = dataEnd;

    if (!name || name.endsWith("/")) continue;

    const compressed = buffer.subarray(dataStart, dataEnd);
    if (compression === 0) {
      entries[name] = compressed.slice();
    } else if (compression === 8) {
      entries[name] = inflateRawSync(compressed);
    } else {
      throw new Error(`Unsupported ZIP compression method ${compression} for ${name}`);
    }
  }

  if (!Object.keys(entries).length) {
    throw new Error("ZIP archive did not contain any files");
  }

  return entries;
};

/** Test helper: build a stored (uncompressed) ZIP from path → UTF-8 contents. */
export const createStoredZip = (files: Record<string, string>): Uint8Array => {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const encoder = new TextEncoder();

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, LOCAL_FILE_HEADER, true);
    localView.setUint16(8, 0, true); // store
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    parts.push(local);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, CENTRAL_DIRECTORY, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    central.push(centralHeader);
    offset += local.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, central.length, true);
  endView.setUint16(10, central.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const total =
    parts.reduce((sum, part) => sum + part.length, 0) + centralSize + end.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  for (const part of central) {
    out.set(part, cursor);
    cursor += part.length;
  }
  out.set(end, cursor);
  return out;
};
