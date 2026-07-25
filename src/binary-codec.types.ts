export type BinarySchema<T extends object> = new () => T;

export interface BinaryScalarFieldMetadata {
  propertyKey: string | symbol;
  type: 'uint32' | 'date' | 'uuid' | 'compactString';
}

export interface BinaryObjectFieldMetadata {
  propertyKey: string | symbol;
  type: 'object';
  classFactory: () => BinarySchema<object>;
}

export type BinaryFieldMetadata =
  BinaryScalarFieldMetadata | BinaryObjectFieldMetadata;
