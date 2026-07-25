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
import { describe, expect, it } from 'vitest';

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
});
