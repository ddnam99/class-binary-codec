import { isUtf8 } from 'buffer';
import { getBinaryFields } from './binary-codec.decorator';
import { BinarySchemaError } from './binary-codec.error';
import { BinaryFieldMetadata, BinarySchema } from './binary-codec.types';

const UUID_BYTE_LENGTH = 16;
const UINT32_BYTE_LENGTH = 4;
const UINT64_BYTE_LENGTH = 8;

enum CompactStringType {
  Uuid = 1,
  UnsignedInteger = 2,
  String = 3,
}

type BinaryRuntimeValue = number | string | Date | object | undefined;
type BinaryRuntimeRecord = Record<string | symbol, BinaryRuntimeValue>;

class BinaryReader {
  private offset = 0;

  constructor(private readonly data: Buffer) {}

  get done(): boolean {
    return this.offset === this.data.length;
  }

  readUInt8(): number | undefined {
    const bytes = this.readBytes(1);
    return bytes?.readUInt8(0);
  }

  readUInt32(): number | undefined {
    const bytes = this.readBytes(UINT32_BYTE_LENGTH);
    return bytes?.readUInt32BE(0);
  }

  readUInt64(): number | undefined {
    const bytes = this.readBytes(UINT64_BYTE_LENGTH);
    if (!bytes) return undefined;

    const value = bytes.readBigUInt64BE(0);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    return Number(value);
  }

  readUuid(): string | undefined {
    const bytes = this.readBytes(UUID_BYTE_LENGTH);
    if (!bytes) return undefined;

    const hex = bytes.toString('hex');
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join('-');
  }

  readString(length: number): string | undefined {
    const bytes = this.readBytes(length);
    return bytes && isUtf8(bytes) ? bytes.toString('utf8') : undefined;
  }

  private readBytes(length: number): Buffer | undefined {
    if (length < 0 || this.offset + length > this.data.length) {
      return undefined;
    }

    const bytes = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }
}

function encodeUInt32(value: BinaryRuntimeValue): Buffer | undefined {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 0xffffffff
  ) {
    return undefined;
  }

  const bytes = Buffer.allocUnsafe(UINT32_BYTE_LENGTH);
  bytes.writeUInt32BE(value, 0);
  return bytes;
}

function encodeUInt64(value: number): Buffer | undefined {
  if (!Number.isSafeInteger(value) || value < 0) return undefined;

  const bytes = Buffer.allocUnsafe(UINT64_BYTE_LENGTH);
  bytes.writeBigUInt64BE(BigInt(value), 0);
  return bytes;
}

function encodeDate(value: BinaryRuntimeValue): Buffer | undefined {
  if (typeof value !== 'string' && !(value instanceof Date)) return undefined;

  const date = value instanceof Date ? value : new Date(value);
  return encodeUInt64(date.getTime());
}

function encodeUuid(value: BinaryRuntimeValue): Buffer | undefined {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      value,
    )
  ) {
    return undefined;
  }

  return Buffer.from(value.replaceAll('-', ''), 'hex');
}

function encodeCompactString(value: BinaryRuntimeValue): Buffer | undefined {
  if (typeof value !== 'string') return undefined;

  const uuid = encodeUuid(value);
  if (uuid) {
    return Buffer.concat([Buffer.from([CompactStringType.Uuid]), uuid]);
  }

  if (/^(0|[1-9]\d*)$/.test(value)) {
    const numericValue = BigInt(value);
    if (numericValue <= 0xffffffffffffffffn) {
      const bytes = Buffer.allocUnsafe(1 + UINT64_BYTE_LENGTH);
      bytes.writeUInt8(CompactStringType.UnsignedInteger, 0);
      bytes.writeBigUInt64BE(numericValue, 1);
      return bytes;
    }
  }

  const stringBytes = Buffer.from(value, 'utf8');
  if (stringBytes.length > 0xff) return undefined;

  return Buffer.concat([
    Buffer.from([CompactStringType.String, stringBytes.length]),
    stringBytes,
  ]);
}

function readDate(reader: BinaryReader): Date | undefined {
  const value = reader.readUInt64();
  if (value === undefined) return undefined;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function readCompactString(reader: BinaryReader): string | undefined {
  const type = reader.readUInt8();

  switch (type) {
    case CompactStringType.Uuid:
      return reader.readUuid();
    case CompactStringType.UnsignedInteger: {
      const high = reader.readUInt32();
      const low = reader.readUInt32();
      if (high === undefined || low === undefined) return undefined;
      return ((BigInt(high) << 32n) | BigInt(low)).toString();
    }
    case CompactStringType.String: {
      const length = reader.readUInt8();
      return length === undefined ? undefined : reader.readString(length);
    }
    default:
      return undefined;
  }
}

function encodeField(
  value: BinaryRuntimeValue,
  field: BinaryFieldMetadata,
): Buffer | undefined {
  switch (field.type) {
    case 'uint32':
      return encodeUInt32(value);
    case 'date':
      return encodeDate(value);
    case 'uuid':
      return encodeUuid(value);
    case 'compactString':
      return encodeCompactString(value);
    case 'object':
      if (
        typeof value !== 'object' ||
        value === null ||
        value instanceof Date
      ) {
        return undefined;
      }
      return encodeObject(value, field.classFactory());
  }
}

function encodeObject<T extends object>(
  data: T,
  schema: BinarySchema<T>,
): Buffer | undefined {
  if (typeof data !== 'object' || data === null) return undefined;

  const fields = getBinaryFields(schema);
  if (!fields.length) return undefined;

  const record = data as BinaryRuntimeRecord;
  const encodedFields: Buffer[] = [];

  for (const field of fields) {
    const encoded = encodeField(record[field.propertyKey], field);
    if (!encoded) return undefined;
    encodedFields.push(encoded);
  }

  return Buffer.concat(encodedFields);
}

function decodeField(
  reader: BinaryReader,
  field: BinaryFieldMetadata,
): BinaryRuntimeValue {
  switch (field.type) {
    case 'uint32':
      return reader.readUInt32();
    case 'date':
      return readDate(reader);
    case 'uuid':
      return reader.readUuid();
    case 'compactString':
      return readCompactString(reader);
    case 'object':
      return decodeObject(reader, field.classFactory());
  }
}

function decodeObject<T extends object>(
  reader: BinaryReader,
  schema: BinarySchema<T>,
): T | undefined {
  const fields = getBinaryFields(schema);
  if (!fields.length) return undefined;

  const result = new schema();
  const record = result as BinaryRuntimeRecord;

  for (const field of fields) {
    const value = decodeField(reader, field);
    if (value === undefined) return undefined;
    record[field.propertyKey] = value;
  }

  return result;
}

export function encodeBinary<T extends object>(
  data: T,
  schema: BinarySchema<T>,
): Buffer | undefined {
  try {
    return encodeObject(data, schema);
  } catch (error) {
    if (error instanceof BinarySchemaError) throw error;
    return undefined;
  }
}

export function decodeBinary<T extends object>(
  data: Buffer,
  schema: BinarySchema<T>,
): T | undefined {
  try {
    const reader = new BinaryReader(data);
    const decoded = decodeObject(reader, schema);
    return reader.done ? decoded : undefined;
  } catch (error) {
    if (error instanceof BinarySchemaError) throw error;
    return undefined;
  }
}

export function encodeBinaryBase64Url<T extends object>(
  data: T,
  schema: BinarySchema<T>,
): string | undefined {
  return encodeBinary(data, schema)?.toString('base64url');
}

export function decodeBase64(value: string): Buffer | undefined {
  if (!value) return undefined;

  try {
    if (/^[A-Za-z0-9_-]+$/.test(value)) {
      const data = Buffer.from(value, 'base64url');
      return data.toString('base64url') === value ? data : undefined;
    }

    if (/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      const data = Buffer.from(value, 'base64');
      const canonical = data.toString('base64');
      const unpadded = canonical.replace(/=+$/, '');
      return value === canonical || value === unpadded ? data : undefined;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

export function decodeBinaryBase64<T extends object>(
  value: string,
  schema: BinarySchema<T>,
): T | undefined {
  const data = decodeBase64(value);
  return data ? decodeBinary(data, schema) : undefined;
}
