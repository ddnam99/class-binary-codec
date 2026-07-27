import { BinarySchemaError } from './binary-codec.error';
import {
  BinaryFieldMetadata,
  BinaryFieldOptions,
  BinaryScalarFieldMetadata,
  BinarySchema,
} from './binary-codec.types';

const binaryFields = new WeakMap<object, BinaryFieldMetadata[]>();

function registerBinaryField(
  target: object,
  metadata: BinaryFieldMetadata,
): void {
  const fields = binaryFields.get(target) ?? [];
  if (fields.some((field) => field.propertyKey === metadata.propertyKey)) {
    throw new BinarySchemaError(
      `Binary field ${String(metadata.propertyKey)} has multiple decorators`,
    );
  }

  fields.push(metadata);
  binaryFields.set(target, fields);
}

function binaryScalarField(
  type: BinaryScalarFieldMetadata['type'],
  options?: BinaryFieldOptions,
): PropertyDecorator {
  return (target, propertyKey) => {
    registerBinaryField(target, {
      propertyKey,
      type,
      ...(options?.nullable ? { nullable: true } : {}),
    });
  };
}

export function BinaryUInt32(options?: BinaryFieldOptions): PropertyDecorator {
  return binaryScalarField('uint32', options);
}

export function BinaryDate(options?: BinaryFieldOptions): PropertyDecorator {
  return binaryScalarField('date', options);
}

export function BinaryUuid(options?: BinaryFieldOptions): PropertyDecorator {
  return binaryScalarField('uuid', options);
}

export function BinaryCompactString(
  options?: BinaryFieldOptions,
): PropertyDecorator {
  return binaryScalarField('compactString', options);
}

export function BinaryObject<T extends object>(
  classFactory: () => BinarySchema<T>,
  options?: BinaryFieldOptions,
): PropertyDecorator {
  return (target, propertyKey) => {
    registerBinaryField(target, {
      propertyKey,
      type: 'object',
      classFactory,
      ...(options?.nullable ? { nullable: true } : {}),
    });
  };
}

export function getBinaryFields<T extends object>(
  schema: BinarySchema<T>,
): readonly BinaryFieldMetadata[] {
  const prototypes: object[] = [];
  let prototype: object | null = schema.prototype;

  while (prototype && prototype !== Object.prototype) {
    prototypes.unshift(prototype);
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }

  const fields: BinaryFieldMetadata[] = [];
  const propertyKeys = new Set<string | symbol>();

  for (const current of prototypes) {
    for (const field of binaryFields.get(current) ?? []) {
      if (propertyKeys.has(field.propertyKey)) {
        throw new BinarySchemaError(
          `Binary field ${String(field.propertyKey)} is decorated in its inheritance chain more than once`,
        );
      }

      propertyKeys.add(field.propertyKey);
      fields.push(field);
    }
  }

  return fields;
}
