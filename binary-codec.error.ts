export class BinarySchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = BinarySchemaError.name;
  }
}
