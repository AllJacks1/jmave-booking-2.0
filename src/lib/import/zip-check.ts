/**
 * Upload validation for the Excel import (Phase 5). Pure.
 *
 * Reads the zip central directory (no decompression) to check that the
 * file really is a workbook (`[Content_Types].xml` and `xl/workbook.xml`)
 * and that it would not expand past a sane size (zip bomb).
 */

/** The booking workbook expands to well under this (its 28 MB are mostly images). */
export const MAX_UNCOMPRESSED_BYTES = 400 * 1024 * 1024;
const MAX_ENTRIES = 20_000;

export type ZipInfo = { entries: string[]; uncompressedBytes: number };

/** Null when the central directory cannot be read (not a zip, truncated, zip64). */
export function readZipDirectory(bytes: Uint8Array): ZipInfo | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory record: signature 0x06054b50, within the last 64 KB + 22 bytes.
  const minStart = Math.max(0, bytes.byteLength - 65_557);
  let eocd = -1;
  for (let i = bytes.byteLength - 22; i >= minStart; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) return null; // zip64: not produced by Excel for workbooks this size
  if (count > MAX_ENTRIES || cdOffset + cdSize > bytes.byteLength) return null;
  const decoder = new TextDecoder();
  const entries: string[] = [];
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.byteLength || view.getUint32(p, true) !== 0x02014b50) return null;
    const uncompressed = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    if (p + 46 + nameLen > bytes.byteLength) return null;
    entries.push(decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen)));
    total += uncompressed;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, uncompressedBytes: total };
}

/** Error text, or null when the zip looks like a workbook of sane size. */
export function checkWorkbookZip(bytes: Uint8Array, maxUncompressed = MAX_UNCOMPRESSED_BYTES): string | null {
  const info = readZipDirectory(bytes);
  if (!info) return "The file is not a valid .xlsx workbook.";
  const names = new Set(info.entries);
  if (!names.has("[Content_Types].xml") || !names.has("xl/workbook.xml")) return "The file is not a valid .xlsx workbook.";
  if (info.entries.some((e) => e.includes("..") || e.startsWith("/") || e.includes("\\"))) return "The file is not a valid .xlsx workbook.";
  if (info.uncompressedBytes > maxUncompressed) return "The workbook is too large to import.";
  return null;
}
