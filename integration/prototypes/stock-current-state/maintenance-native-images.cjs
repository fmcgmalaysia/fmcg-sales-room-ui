'use strict';

// Explicit private backup encoding. Dates are tagged by their actual native type,
// never by field-name or ISO-looking text. JSON persistence cannot erase the
// _updatedDate Date needed by the existing metadata initialization condition.
function encodeMaintenanceNativeImage(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (!Number.isFinite(value.getTime())) throw Error('Valid native backup Date required');
    return ['DATE', value.toISOString()];
  }
  if (value === null) return ['NULL'];
  if (typeof value === 'string') return ['TEXT', value];
  if (typeof value === 'boolean') return ['BOOLEAN', value];
  if (typeof value === 'number' && Number.isFinite(value)) return ['NUMBER', Object.is(value, -0) ? '-0' : value];
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw Error('Dense native backup array required');
    return ['ARRAY', value.map(encodeMaintenanceNativeImage)];
  }
  const proto = value && typeof value === 'object' && Object.getPrototypeOf(value);
  if (value && typeof value === 'object' && (proto === null || Object.getPrototypeOf(proto) === null
    && Object.getOwnPropertyDescriptor(proto, 'constructor')?.value?.name === 'Object') && !Object.getOwnPropertySymbols(value).length) {
    // Existing nested business snapshots may be hashed as original JSON. Keep
    // their key order; canonical protocol-metadata comparison is separate.
    return ['OBJECT', Object.keys(value).map(key => [key, encodeMaintenanceNativeImage(value[key])])];
  }
  throw Error('Supported native backup value required');
}

function decodeMaintenanceNativeImage(value) {
  if (!Array.isArray(value)) throw Error('Tagged native backup image required');
  const [type, data] = value;
  if (type === 'NULL' && value.length === 1) return null;
  if (value.length !== 2) throw Error('Exact tagged native backup image required');
  if (type === 'TEXT' && typeof data === 'string' || type === 'BOOLEAN' && typeof data === 'boolean') return data;
  if (type === 'NUMBER' && (typeof data === 'number' && Number.isFinite(data) && !Object.is(data, -0) || data === '-0')) return data === '-0' ? -0 : data;
  if (type === 'DATE' && typeof data === 'string') {
    const date = new Date(data);
    if (Number.isFinite(date.getTime()) && date.toISOString() === data) return date;
  }
  if (type === 'ARRAY' && Array.isArray(data)) return data.map(decodeMaintenanceNativeImage);
  if (type === 'OBJECT' && Array.isArray(data) && data.every(entry => Array.isArray(entry) && entry.length === 2
    && typeof entry[0] === 'string') && new Set(data.map(entry => entry[0])).size === data.length) {
    return Object.fromEntries(data.map(([key, image]) => [key, decodeMaintenanceNativeImage(image)]));
  }
  throw Error('Valid exact native backup image required');
}
module.exports = { encodeMaintenanceNativeImage, decodeMaintenanceNativeImage };
