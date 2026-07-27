export type BinarySchema<T extends object> = new () => T;

export interface BinaryFieldOptions {
  nullable?: boolean;
}

export interface BinaryScalarFieldMetadata {
  propertyKey: string | symbol;
  type: 'uint32' | 'date' | 'uuid' | 'compactString';
  nullable?: boolean;
}

export interface BinaryObjectFieldMetadata {
  propertyKey: string | symbol;
  type: 'object';
  classFactory: () => BinarySchema<object>;
  nullable?: boolean;
}

export type BinaryFieldMetadata =
  | BinaryScalarFieldMetadata
  | BinaryObjectFieldMetadata;

