/** Pointer drag helper for 3D preview zones (mouse + touch), plus wheel. */
export function attachDrag(el, onDrag, onWheel) {
  let down = false, lx = 0, ly = 0;
  el.addEventListener('pointerdown', (e) => { down = true; lx = e.clientX; ly = e.clientY; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', (e) => { if (!down) return; onDrag(e.clientX - lx, e.clientY - ly); lx = e.clientX; ly = e.clientY; });
  const up = () => { down = false; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  if (onWheel) el.addEventListener('wheel', (e) => { e.preventDefault(); onWheel(e.deltaY); }, { passive: false });
}
