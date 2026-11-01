'use strict';
// Portable SHA-256 for the self-contained offline exercise, never a runtime
// replacement in Wix. Standard byte/UTF-8 vectors are checked against Node crypto.
const rotate = (n, bits) => (n >>> bits) | (n << (32 - bits));
function sha256(bytes) {
  const constants = [], initial = [];
  for (let n = 2; constants.length < 64; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (prime) {
      if (initial.length < 8) initial.push((Math.sqrt(n) % 1 * 0x100000000) >>> 0);
      constants.push((Math.cbrt(n) % 1 * 0x100000000) >>> 0);
    }
  }
  const length = bytes.length, padded = new Uint8Array(Math.ceil((length + 9) / 64) * 64);
  padded.set(bytes); padded[length] = 128;
  const view = new DataView(padded.buffer), bitLength = length * 8;
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);
  const state = initial.slice(), words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = words[i - 15], y = words[i - 2];
      words[i] = (words[i - 16] + (rotate(x, 7) ^ rotate(x, 18) ^ x >>> 3) + words[i - 7] + (rotate(y, 17) ^ rotate(y, 19) ^ y >>> 10)) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[i] + words[i]) >>> 0;
      const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { state[i] = (state[i] + v) >>> 0; });
  }
  return state.map(v => v.toString(16).padStart(8, '0')).join('');
}
function createHash(algorithm) {
  if (algorithm !== 'sha256') throw Error('Offline SHA-256 only');
  const chunks = [];
  return { update(value) { chunks.push(typeof value === 'string' ? new TextEncoder().encode(value) : Uint8Array.from(value)); return this; },
    digest(format) { if (format !== 'hex') throw Error('Offline hex digest only'); const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; } return sha256(bytes); } };
}
module.exports = { createHash };
