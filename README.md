# Class Binary Codec

Class Binary Codec serializes decorated TypeScript classes into compact,
deterministic, fixed-layout Node.js `Buffer` values. The wire payload contains
only field values: it omits field names, object keys, and structural metadata.
This is useful when both producer and consumer already share the same schema,
such as pagination tokens, cursors, cache keys, compact identifiers, and small
internal payloads.

This is serialization, not entropy compression such as gzip or zstd. Use a
self-describing format such as JSON when schemas must evolve independently,
consumers do not share the class definition, or optional fields and collections
are required. Use a compression library for large or arbitrary data.

## Install

```bash
npm install class-binary-codec
```

Requires Node.js 18.14 or newer.

## Usage

Decorate every serialized field, then pass the root class as the schema.

```ts
import {
  BinaryCompactString,
  BinaryDate,
  BinaryObject,
  BinaryUInt32,
  BinaryUuid,
  decodeBinaryBase64,
  encodeBinaryBase64Url,
} from 'class-binary-codec';

class Anchor {
  @BinaryUInt32()
  position!: number;

  @BinaryCompactString()
  key!: string;
}

class PageToken {
  @BinaryUuid()
  userId!: string;

  @BinaryDate()
  createdAt!: Date;

  @BinaryObject(() => Anchor)
  anchor!: Anchor;
}

const payload: PageToken = {
  userId: 'b84287c5-7f25-11f1-addc-7a0328b9b7d0',
  createdAt: new Date('2026-07-24T08:10:11.123Z'),
  anchor: {
    position: 1_783_993_532,
    key: '00042',
  },
};

const encoded = encodeBinaryBase64Url(payload, PageToken);
if (encoded === undefined) {
  throw new Error('Encoding failed');
}

console.log(encoded);
// uEKHxX8lEfGt3HoDKLm30AAAAZ-TLL8zalWUvAMFMDAwNDI

const decoded = decodeBinaryBase64(encoded, PageToken);
if (decoded === undefined) {
  throw new Error('Decoding failed');
}

console.log(decoded.createdAt.toISOString());
// 2026-07-24T08:10:11.123Z
```

## Run the example

The complete runnable example is
[`binary-codec-example.ts`](./binary-codec-example.ts):

```bash
npx tsx binary-codec-example.ts
```

The example registers the same property decorators as functions, for example
`BinaryUInt32()(Anchor.prototype, 'position')`. This makes it runnable without a
`tsconfig` configured for legacy TypeScript decorator syntax.

For the checked-in payload, the wire output is deterministic:

| Representation | Output |
| --- | --- |
| Hex | `b84287c57f2511f1addc7a0328b9b7d00000019f932cbf336a5594bc03053030303432` |
| Base64URL | `uEKHxX8lEfGt3HoDKLm30AAAAZ-TLL8zalWUvAMFMDAwNDI` |
| Binary size | 35 bytes |
| Base64URL size | 47 characters |
| JSON UTF-8 size | 135 bytes |
| Binary size reduction | 74.1% versus this JSON payload |

## Wire format

Values use network byte order (big-endian). No field identifiers, presence
markers, object lengths, schema IDs, or version bytes are added.

| Decorator | Accepted value | Wire size |
| --- | --- | --- |
| `@BinaryUInt32()` | Integer from `0` through `4_294_967_295` | 4 bytes |
| `@BinaryDate()` | Valid `Date` or date string with a non-negative, safe-integer millisecond timestamp | 8 bytes |
| `@BinaryUuid()` | Canonical hyphenated UUID string | 16 bytes |
| `@BinaryCompactString()` | Canonical UUID string | 17 bytes: 1-byte type + 16 bytes |
| `@BinaryCompactString()` | Unsigned decimal string without leading zeroes, except `"0"`, through `2^64 - 1` | 9 bytes: 1-byte type + 8 bytes |
| `@BinaryCompactString()` | Other UTF-8 string | 2-257 bytes: 1-byte type + 1-byte length + 0-255 data bytes |
| `@BinaryObject(() => Type)` | Nested decorated object | Sum of its decorated fields; no wrapper bytes |

`BinaryCompactString` preserves leading-zero strings such as `"00042"` by
using the UTF-8 representation rather than the unsigned-integer
representation.

## Schema contract and constraints

- Decorated field order is the wire contract. Base-class fields are encoded
  before subclass fields; nested objects are traversed recursively. Reordering,
  adding, removing, or changing a decorator changes the bytes expected by
  readers.
- Schema classes must have a zero-argument constructor because decoding creates
  each result with `new schema()`.
- Every decorated field is required. There is no representation for
  `undefined`, `null`, optional fields, or arrays.
- There is no built-in magic prefix, schema identifier, version framing, or
  migration support. Add an external envelope when a payload needs versioning.
- The general `BinaryCompactString` UTF-8 form is limited to 255 encoded bytes.
- Decoding rejects truncated data, trailing data, invalid UTF-8, unknown compact
  string tags, and numeric values that cannot be represented safely.
- Normal encoding and decoding failures return `undefined`.
  `BinarySchemaError` is thrown for schema conflicts such as decorating the same
  property more than once, including conflicts across an inheritance chain.
- `decodeBinaryBase64` accepts canonical Base64URL and standard Base64 input;
  `encodeBinaryBase64Url` emits unpadded Base64URL.

## Performance

One local reference run of
[`binary-codec-example.ts`](./binary-codec-example.ts) used 100,000 iterations
on Node.js 26.5.0 (`darwin/arm64`):

| Operation | Throughput |
| --- | ---: |
| Binary encode | 869,962 ops/s |
| Binary decode | 1,120,890 ops/s |
| `JSON.stringify` | 858,940 ops/s |
| `JSON.parse` | 2,155,773 ops/s |

These figures are a single local measurement, not a universal performance
claim. Benchmark results vary with hardware, Node.js version, schema, payload,
and warm-up effects; rerun the example on the target system. JSON parsing also
does not restore `Date` instances, while binary decoding does. Size reduction
depends on the schema and data; the 74.1% result applies only to the example
payload above.

## Development

```bash
npm install
npm run check
```

`npm run check` type-checks the source, runs the Vitest suite, and builds ESM,
CommonJS, source maps, and TypeScript declarations.

Before publishing, inspect the package contents:

```bash
npm pack --dry-run
```

## License

[MIT](./LICENSE)
