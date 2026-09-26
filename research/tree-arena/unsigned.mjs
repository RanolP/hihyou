// Typed-array access patterns an arena tree would use, timed in V8. No Node APIs, so the same file runs in a
// browser (unsigned.html) where pointer compression shrinks the small-integer range to 31 bits.
//
//   node research/tree-arena/unsigned.mjs

const N = 1 << 20; // words per array: about a 300K-node tree at 3-4 words a node
const RUNS = 9;
const WARMUP = 3;
const log = globalThis.benchLog ?? console.log;
let sink = 0;

function time(fn) {
  for (let i = 0; i < WARMUP; i++) sink ^= fn() | 0;
  const xs = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    sink ^= fn() | 0;
    xs.push(performance.now() - t);
  }
  xs.sort((a, b) => a - b);
  return xs[xs.length >> 1];
}

const rows = [];
const row = (group, name, ms) => {
  rows.push([group, name, ms]);
  log(`${group.padEnd(10)} ${name.padEnd(46)} ${ms.toFixed(3).padStart(8)} ms`);
};

// Random-looking but deterministic values in [lo, lo + span).
function fill(a, lo, span) {
  let x = 12345;
  for (let i = 0; i < a.length; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    a[i] = lo + (x % span);
  }
  return a;
}

// Each variant gets its own function compiled from source, so no two share type feedback: closures of one
// function literal would see both array types and turn polymorphic.
let freshId = 0;
// A unique comment per variant, or the compilation cache hands back one shared function for equal source.
const fresh = (params, body) =>
  new Function(...params, `${body} // variant ${freshId++}`);
const SUM = "let acc = 0; for (let i = 0; i < a.length; i++) acc += a[i]; return acc;";
const EQ = "let c = 0; for (let i = 0; i < a.length; i++) if (a[i] === k) c++; return c;";
const BOX = "for (let i = 0; i < a.length; i++) out[i] = a[i]; return out.length;";
const STORE = "for (let i = 0; i < a.length; i++) a[i] = k + i; return a[7];";

// 1. Loads: sum, compare, and copy into a plain JS array (where a non-small value must be boxed).
const ranges = [
  ["< 2^30", 0, 2 ** 30 - 1],
  ["2^30..2^31", 2 ** 30, 2 ** 30 - 1],
  [">= 2^31", 2 ** 31, 2 ** 31 - 1],
];
for (const [label, lo, span] of ranges) {
  const u = fill(new Uint32Array(N), lo, span);
  const s = new Int32Array(u.buffer); // same bits; reads >= 2^31 come back negative
  for (const [type, a, k] of [
    ["Uint32", u, lo + 7],
    ["Int32 ", s, (lo + 7) | 0],
  ]) {
    const sum = fresh(["a"], SUM);
    const eq = fresh(["a", "k"], EQ);
    const box = fresh(["a", "out"], BOX);
    const out = new Array(N).fill(0);
    row("load", `${type} sum, ${label}`, time(() => sum(a)));
    row("load", `${type} === compare, ${label}`, time(() => eq(a, k)));
    row("load", `${type} copy into JS array, ${label}`, time(() => box(a, out)));
    // An array that already holds objects keeps tagged values, so a non-small number is boxed per store: the
    // case of a handle kept in an object field, a Map, or a Doc token.
    const boxTagged = fresh(["a", "out"], BOX);
    const tagged = new Array(N).fill(null).map(() => ({}));
    row("load", `${type} copy into object array, ${label}`, time(() => boxTagged(a, tagged)));
  }
}

// 2. Stores.
for (const [type, make] of [
  ["Uint32", () => new Uint32Array(N)],
  ["Int32 ", () => new Int32Array(N)],
])
  for (const [label, k] of [
    ["< 2^30", 0],
    [">= 2^31", 2 ** 31],
  ]) {
    const store = fresh(["a", "k"], STORE);
    const a = make();
    row("store", `${type} store, ${label}`, time(() => store(a, k)));
  }

// 3. A record head of kind (u16), field (u8) and flags (u8). Records are 4 words: [head, start, end, x].
// The traversal reads every record's kind, field and one flag, the way a rule dispatch does.
{
  const R = N >> 2;
  const words = new Uint32Array(N);
  const kindOf = (i) => (i * 7) % 300;
  const fieldOf = (i) => i % 13;
  const flagsOf = (i) => (i & 1) | ((i % 5 === 0 ? 1 : 0) << 1);
  // Packed with bit 31 clear: flags limited to 7 bits so the word stays a small integer.
  for (let r = 0; r < R; r++)
    words[r * 4] = kindOf(r) | (fieldOf(r) << 16) | (flagsOf(r) << 24);
  const packed = () => {
    let acc = 0;
    for (let o = 0; o < words.length; o += 4) {
      const h = words[o];
      acc += (h & 0xffff) + ((h >>> 16) & 0xff) + ((h >>> 24) & 1);
    }
    return acc;
  };
  // Same bytes read through narrower views over one buffer (little-endian: kind at byte 0, field 2, flags 3).
  const u16 = new Uint16Array(words.buffer);
  const u8 = new Uint8Array(words.buffer);
  const views = () => {
    let acc = 0;
    for (let o = 0; o < words.length; o += 4) {
      const b = o << 2;
      acc += u16[o << 1] + u8[b + 2] + (u8[b + 3] & 1);
    }
    return acc;
  };
  // Separate columns (structure of arrays), indexed by record number.
  const kindCol = new Uint16Array(R);
  const fieldCol = new Uint8Array(R);
  const flagCol = new Uint8Array(R);
  for (let r = 0; r < R; r++) {
    kindCol[r] = kindOf(r);
    fieldCol[r] = fieldOf(r);
    flagCol[r] = flagsOf(r);
  }
  const columns = () => {
    let acc = 0;
    for (let r = 0; r < R; r++) acc += kindCol[r] + fieldCol[r] + (flagCol[r] & 1);
    return acc;
  };
  const dv = new DataView(words.buffer);
  const dataView = () => {
    let acc = 0;
    for (let o = 0; o < words.length; o += 4) {
      const b = o << 2;
      acc += dv.getUint16(b, true) + dv.getUint8(b + 2) + (dv.getUint8(b + 3) & 1);
    }
    return acc;
  };
  const dataView32 = () => {
    let acc = 0;
    for (let o = 0; o < words.length; o += 4) {
      const h = dv.getUint32(o << 2, true);
      acc += (h & 0xffff) + ((h >>> 16) & 0xff) + ((h >>> 24) & 1);
    }
    return acc;
  };
  // Every flag set, so bit 31 is set when flags use all 8 bits.
  const high = new Uint32Array(N);
  for (let r = 0; r < R; r++) high[r * 4] = kindOf(r) | (fieldOf(r) << 16) | (0xff << 24);
  const packedHigh = () => {
    let acc = 0;
    for (let o = 0; o < high.length; o += 4) {
      const h = high[o];
      acc += (h & 0xffff) + ((h >>> 16) & 0xff) + ((h >>> 24) & 1);
    }
    return acc;
  };
  row("head", "one Uint32 word, shift/mask", time(packed));
  row("head", "one Uint32 word, bit 31 set", time(packedHigh));
  row("head", "Uint16 + Uint8 views over the same buffer", time(views));
  row("head", "separate columns (SoA)", time(columns));
  row("head", "DataView getUint16/getUint8", time(dataView));
  row("head", "DataView getUint32, shift/mask", time(dataView32));
}

// 4. Growth: append `nodes` 4-word records into an arena that starts at 1K words and doubles by copy, versus one
// sized up front, versus a plain JS array.
{
  const nodes = 300_000;
  const doubling = () => {
    let buf = new Uint32Array(1024);
    let top = 0;
    for (let i = 0; i < nodes; i++) {
      if (top + 4 > buf.length) {
        const next = new Uint32Array(buf.length * 2);
        next.set(buf);
        buf = next;
      }
      buf[top] = i & 0xffff;
      buf[top + 1] = i;
      buf[top + 2] = i + 1;
      buf[top + 3] = i >> 1;
      top += 4;
    }
    return buf[top - 1];
  };
  const presized = () => {
    const buf = new Uint32Array(nodes * 4);
    let top = 0;
    for (let i = 0; i < nodes; i++) {
      buf[top] = i & 0xffff;
      buf[top + 1] = i;
      buf[top + 2] = i + 1;
      buf[top + 3] = i >> 1;
      top += 4;
    }
    return buf[top - 1];
  };
  const jsArray = () => {
    const buf = [];
    for (let i = 0; i < nodes; i++) buf.push(i & 0xffff, i, i + 1, i >> 1);
    return buf[buf.length - 1];
  };
  // ArrayBuffer.prototype.resize: grows in place up to maxByteLength, no copy, same views.
  const resizable = () => {
    const ab = new ArrayBuffer(4096, { maxByteLength: 1 << 28 });
    const buf = new Uint32Array(ab); // length-tracking view
    let top = 0;
    for (let i = 0; i < nodes; i++) {
      if (top + 4 > buf.length) ab.resize(ab.byteLength * 2);
      buf[top] = i & 0xffff;
      buf[top + 1] = i;
      buf[top + 2] = i + 1;
      buf[top + 3] = i >> 1;
      top += 4;
    }
    return buf[top - 1];
  };
  row("grow", "300K records, double + copy from 1K words", time(doubling));
  row("grow", "300K records, presized", time(presized));
  row("grow", "300K records, resizable ArrayBuffer", time(resizable));
  row("grow", "300K records, JS array push", time(jsArray));
}

log(`sink ${sink}`);
export { rows };
