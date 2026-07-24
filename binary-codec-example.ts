import { performance } from 'node:perf_hooks';
import {
  BinaryCompactString,
  BinaryDate,
  BinaryObject,
  BinaryUInt32,
  BinaryUuid,
  decodeBinary,
  encodeBinary,
  encodeBinaryBase64Url,
} from './index';

const BENCHMARK_ITERATIONS = 100_000;
const UUID = 'b84287c5-7f25-11f1-addc-7a0328b9b7d0';

class Anchor {
  position!: number;
  key!: string;
}

class PageToken {
  userId!: string;
  createdAt!: Date;
  anchor!: Anchor;
}

// Function-style registration keeps this example runnable without requiring a
// tsconfig file for legacy TypeScript decorator syntax.
BinaryUInt32()(Anchor.prototype, 'position');
BinaryCompactString()(Anchor.prototype, 'key');
BinaryUuid()(PageToken.prototype, 'userId');
BinaryDate()(PageToken.prototype, 'createdAt');
BinaryObject(() => Anchor)(PageToken.prototype, 'anchor');

const payload: PageToken = {
  userId: UUID,
  createdAt: new Date('2026-07-24T08:10:11.123Z'),
  anchor: {
    position: 1_783_993_532,
    key: '00042',
  },
};

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`${label} failed`);
  }
  return value;
}

function benchmark(
  label: string,
  iterations: number,
  operation: () => void,
): void {
  for (let index = 0; index < Math.min(iterations, 10_000); index += 1) {
    operation();
  }

  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    operation();
  }
  const elapsedMs = performance.now() - startedAt;
  const operationsPerSecond = Math.round(iterations / (elapsedMs / 1_000));

  console.log(
    `${label.padEnd(18)} ${operationsPerSecond.toLocaleString('en-US')} ops/s`,
  );
}

const encoded = required(encodeBinary(payload, PageToken), 'Binary encoding');
const encodedBase64Url = required(
  encodeBinaryBase64Url(payload, PageToken),
  'Base64URL encoding',
);
const decoded = required(
  decodeBinary(encoded, PageToken),
  'Binary decoding',
);
const json = JSON.stringify(payload);
const jsonBytes = Buffer.byteLength(json);

console.log('Input:');
console.log(JSON.stringify(payload, null, 2));
console.log('\nEncoded:');
console.log(`Binary hex:       ${encoded.toString('hex')}`);
console.log(`Base64URL:        ${encodedBase64Url}`);
console.log(`Binary size:      ${encoded.length} bytes`);
console.log(`Base64URL size:   ${encodedBase64Url.length} characters`);
console.log(`JSON UTF-8 size:  ${jsonBytes} bytes`);
console.log(
  `Binary saving:    ${(((jsonBytes - encoded.length) / jsonBytes) * 100).toFixed(1)}% vs JSON`,
);
console.log('\nDecoded:');
console.log(JSON.stringify(decoded, null, 2));

console.log(
  `\nBenchmark (${BENCHMARK_ITERATIONS.toLocaleString('en-US')} iterations, Node ${process.versions.node}, ${process.platform}/${process.arch}):`,
);
benchmark('Binary encode', BENCHMARK_ITERATIONS, () => {
  required(encodeBinary(payload, PageToken), 'Binary encoding');
});
benchmark('Binary decode', BENCHMARK_ITERATIONS, () => {
  required(decodeBinary(encoded, PageToken), 'Binary decoding');
});
benchmark('JSON stringify', BENCHMARK_ITERATIONS, () => {
  JSON.stringify(payload);
});
benchmark('JSON parse', BENCHMARK_ITERATIONS, () => {
  JSON.parse(json);
});
