'use strict';

// Isolated presentation candidate. Shapes copied unchanged from current task-grid.js
// and supplier-allocation.js. No permissions, allocation or colour-state decisions.
const shapes = {
  TASK_GRID: '<circle cx="10" cy="5" r="4"/><path d="M2 19v-3a8 7 0 0 1 16 0v3z"/>',
  ALLOCATION: '<circle cx="10" cy="5" r="3"/><path d="M4 18v-3a6 6 0 0 1 12 0v3z"/>'
};
function haloSvg(ordinary, open) {
  if (typeof open !== 'boolean' || !Object.values(shapes).some(shape => ordinary === '<svg viewBox="0 0 20 20">' + shape + '</svg>'
    || ordinary === '<svg viewBox="0 0 20 20" aria-hidden="true">' + shape + '</svg>')) throw Error('Exact original person shape required');
  return open ? ordinary.replace('>', ' style="fill:currentColor;overflow:visible"><ellipse cx="10" cy="-2.5" rx="5.5" ry="1.5" fill="none" stroke="currentColor" stroke-width="1.25"/>') : ordinary;
}
function transferPerson({ taskId, relations, variant = 'TASK_GRID' }) {
  if (typeof taskId !== 'string' || !taskId || !Array.isArray(relations) || !Object.hasOwn(shapes, variant)) throw Error('Verified person display context required');
  for (const r of relations) {
    if (!r.id || !r.borrowerTaskId || !r.lenderTaskId || !Number.isSafeInteger(r.quantity) || r.quantity <= 0
      || !Number.isSafeInteger(r.repaid) || r.repaid < 0 || !Number.isSafeInteger(r.returned ?? 0) || (r.returned || 0) < 0
      || r.repaid + (r.returned || 0) > r.quantity) throw Error('Transfer display requires known quantities');
  }
  const halo = relations.some(r => (r.borrowerTaskId === taskId || r.lenderTaskId === taskId) && r.repaid + (r.returned || 0) < r.quantity);
  // Same canvas/body scale as the original CSS-sized icon. Halo paints above it;
  // expanding viewBox would shrink the original head inside existing16px CSS boxes.
  // currentColor inherits the existing orange/blue state; no gradient, triangle or badge.
  const svg = haloSvg('<svg viewBox="0 0 20 20" aria-hidden="true">' + shapes[variant] + '</svg>', halo);
  return { halo, svg };
}
module.exports = { transferPerson, haloSvg };
