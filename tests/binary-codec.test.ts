import {
  BinaryCompactString,
  BinaryDate,
  BinaryObject,
  BinarySchemaError,
  BinaryUInt32,
  BinaryUuid,
  decodeBinary,
  decodeBinaryBase64,
  encodeBinary,
  encodeBinaryBase64Url,
} from '../src/index';
import { describe, expect, it, vi } from 'vitest';

const UUID = 'b84287c5-7f25-11f1-addc-7a0328b9b7d0';

class NestedPayload {
  @BinaryUInt32()
  count!: number;

  @BinaryCompactString()
  key!: string;
}

class TestPayload {
  @BinaryDate()
  createdAt!: string | Date;

  @BinaryUuid()
  id!: string;

  @BinaryObject(() => NestedPayload)
  nested!: NestedPayload;
}

class BasePayload {
  @BinaryUInt32()
  position!: number;
}

class InheritedPayload extends BasePayload {
  @BinaryUuid()
  id!: string;
}

describe('binary codec library', () => {
  it('round-trips decorated nested classes through Buffer and Base64URL', () => {
    const payload: TestPayload = {
      createdAt: new Date('2026-07-24T08:10:11.123Z'),
      id: UUID,
      nested: {
        count: 42,
        key: '00042',
      },
    };

    const encoded = encodeBinary(payload, TestPayload);
    const encodedBase64 = encodeBinaryBase64Url(payload, TestPayload);

    expect(encoded).toHaveLength(35);
    expect(decodeBinary(encoded as Buffer, TestPayload)).toEqual(payload);
    expect(decodeBinaryBase64(encodedBase64 as string, TestPayload)).toEqual(
      payload,
    );
  });

  it('encodes inherited fields before subclass fields', () => {
    const payload: InheritedPayload = {
      position: 1_783_993_532,
      id: UUID,
    };

    const encoded = encodeBinary(payload, InheritedPayload);

    expect(encoded?.readUInt32BE(0)).toBe(payload.position);
    expect(decodeBinary(encoded as Buffer, InheritedPayload)).toEqual(payload);
  });

  it('rejects trailing bytes and duplicate field decorators', () => {
    const payload: InheritedPayload = {
      position: 1_783_993_532,
      id: UUID,
    };
    const encoded = encodeBinary(payload, InheritedPayload) as Buffer;

    expect(
      decodeBinary(
        Buffer.concat([encoded, Buffer.from([0])]),
        InheritedPayload,
      ),
    ).toBeUndefined();

    class InvalidPayload {
      value!: number;
    }

    BinaryUInt32()(InvalidPayload.prototype, 'value');
    expect(() => BinaryUuid()(InvalidPayload.prototype, 'value')).toThrow(
      BinarySchemaError,
    );
  });

  it('surfaces inherited schema conflicts', () => {
    class Parent {
      value!: number;
    }
    class Child extends Parent {
      override value!: number;
    }

    BinaryUInt32()(Parent.prototype, 'value');
    BinaryUInt32()(Child.prototype, 'value');

    expect(() =>
      encodeBinary({ value: 1 } as Child, Child),
    ).toThrow(BinarySchemaError);
  });

  it('rejects oversized compact strings before numeric conversion', () => {
    class CompactPayload {
      @BinaryCompactString()
      value!: string;
    }

    const bigIntSpy = vi.spyOn(globalThis, 'BigInt');

    try {
      expect(
        encodeBinary({ value: '1'.repeat(256) }, CompactPayload),
      ).toBeUndefined();
      expect(bigIntSpy).not.toHaveBeenCalled();

      const valueAboveUInt64 = '18446744073709551616';
      const encoded = encodeBinary({ value: valueAboveUInt64 }, CompactPayload);

      expect(encoded).toHaveLength(2 + valueAboveUInt64.length);
      expect(decodeBinary(encoded as Buffer, CompactPayload)?.value).toBe(
        valueAboveUInt64,
      );

      const maxUtf8Value = `${'é'.repeat(127)}a`;
      const maxUtf8Encoded = encodeBinary(
        { value: maxUtf8Value },
        CompactPayload,
      );

      expect(Buffer.byteLength(maxUtf8Value)).toBe(255);
      expect(maxUtf8Encoded).toHaveLength(257);
      expect(
        decodeBinary(maxUtf8Encoded as Buffer, CompactPayload)?.value,
      ).toBe(maxUtf8Value);

      const oversizedUtf8Value = 'é'.repeat(128);
      expect(Buffer.byteLength(oversizedUtf8Value)).toBe(256);
      expect(
        encodeBinary({ value: oversizedUtf8Value }, CompactPayload),
      ).toBeUndefined();
    } finally {
      bigIntSpy.mockRestore();
    }
  });

  it('supports nullable scalar and object fields', () => {
    class NullableSubObject {
      @BinaryUInt32({ nullable: true })
      num?: number | null | undefined;
    }

    class NullablePayload {
      @BinaryUInt32({ nullable: true })
      age?: number | null | undefined;

      @BinaryCompactString({ nullable: true })
      name?: string | null | undefined;

      @BinaryDate({ nullable: true })
      birthDate?: Date | null | undefined;

      @BinaryUuid({ nullable: true })
      id?: string | null | undefined;

      @BinaryObject(() => NullableSubObject, { nullable: true })
      sub?: NullableSubObject | null | undefined;
    }

    // 1. All fields null
    const nullPayload: NullablePayload = {
      age: null,
      name: null,
      birthDate: null,
      id: null,
      sub: null,
    };
    const encodedNull = encodeBinary(nullPayload, NullablePayload);
    expect(encodedNull).toHaveLength(5); // 5 fields * 1 byte (0x00)
    expect(decodeBinary(encodedNull as Buffer, NullablePayload)).toEqual({
      age: null,
      name: null,
      birthDate: null,
      id: null,
      sub: null,
    });

    // 2. All fields undefined
    const undefinedPayload: NullablePayload = {};
    const encodedUndefined = encodeBinary(undefinedPayload, NullablePayload);
    expect(encodedUndefined).toHaveLength(5);
    expect(decodeBinary(encodedUndefined as Buffer, NullablePayload)).toEqual({
      age: null,
      name: null,
      birthDate: null,
      id: null,
      sub: null,
    });

    // 3. All fields present
    const date = new Date('2026-07-27T00:00:00.000Z');
    const presentPayload: NullablePayload = {
      age: 25,
      name: 'Alice',
      birthDate: date,
      id: UUID,
      sub: { num: 100 },
    };
    const encodedPresent = encodeBinary(presentPayload, NullablePayload);
    // age: 1 + 4 = 5
    // name: 1 + 2 + 5 = 8
    // birthDate: 1 + 8 = 9
    // id: 1 + 16 = 17
    // sub: 1 + (1 + 4) = 6
    // Total = 5 + 8 + 9 + 17 + 6 = 45 bytes
    expect(encodedPresent).toHaveLength(45);
    const decodedPresent = decodeBinary(encodedPresent as Buffer, NullablePayload);
    expect(decodedPresent).toEqual({
      age: 25,
      name: 'Alice',
      birthDate: date,
      id: UUID,
      sub: { num: 100 },
    });

    // 4. Partial fields (some fields present, some null or undefined)
    const partialPayload: NullablePayload = {
      age: 30,
      name: null,
      birthDate: date,
      id: undefined,
      sub: { num: null },
    };
    const encodedPartial = encodeBinary(partialPayload, NullablePayload);
    // age: 1 + 4 = 5 bytes (0x01 + uint32)
    // name: 1 byte (0x00)
    // birthDate: 1 + 8 = 9 bytes (0x01 + uint64 date)
    // id: 1 byte (0x00)
    // sub: 1 + (1) = 2 bytes (0x01 + sub-object with 0x00 num)
    // Total = 5 + 1 + 9 + 1 + 2 = 18 bytes
    expect(encodedPartial).toHaveLength(18);
    const decodedPartial = decodeBinary(encodedPartial as Buffer, NullablePayload);
    expect(decodedPartial).toEqual({
      age: 30,
      name: null,
      birthDate: date,
      id: null,
      sub: { num: null },
    });
  });
});

