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
});
