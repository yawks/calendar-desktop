/** Keep the message header visible while magnifying only the email body. */
export function installEmailPinchZoom(frame: HTMLIFrameElement, root: HTMLElement, resize: () => void) {
  const doc = root.ownerDocument;
  const block = frame.closest('.mail-message-block');
  const header = block?.querySelector<HTMLElement>('.mail-message-block__header');
  if (!header) return () => {};
  let scroller = block?.parentElement ?? null;
  while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  if (!scroller) return () => {};
  const scrollParent = scroller;
  let scale = 1;
  let shifted = 0;
  let gesture: { distance: number; scale: number; anchor: number; anchorX: number; anchorY: number; shifted: number } | null = null;
  const distance = (touches: TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
  const start = (event: TouchEvent) => {
    if (event.touches.length !== 2) return;
    const span = distance(event.touches);
    if (!span) return;
    event.preventDefault();
    const centerX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
    const centerY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
    const bounds = root.getBoundingClientRect();
    gesture = {
      distance: span, scale, anchor: centerY / scale, shifted,
      anchorX: (centerX - bounds.left) / scale,
      anchorY: (centerY - bounds.top) / scale,
    };
  };
  const move = (event: TouchEvent) => {
    if (!gesture || event.touches.length !== 2) return;
    event.preventDefault();
    scale = Math.max(1, gesture.scale * distance(event.touches) / gesture.distance);
    root.style.transformOrigin = 'top left';
    root.style.transform = `scale(${scale})`;
    resize();
    const remaining = Math.max(0, header.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top);
    const desired = Math.min(shifted + remaining, Math.max(0, gesture.shifted + (scale - gesture.scale) * gesture.anchor));
    const before = scrollParent.scrollTop;
    scrollParent.scrollTop += desired - shifted;
    const scrollDelta = scrollParent.scrollTop - before;
    shifted += scrollDelta;
    const centerX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
    const centerY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
    // Once the header stops moving, pan the body to keep the same content under the fingers.
    const offsetY = scale === 1 ? 0 : Math.max(0, gesture.anchorY * scale - centerY - scrollDelta);
    root.style.transform = offsetY ? `translateY(${-offsetY}px) scale(${scale})` : `scale(${scale})`;
    resize();
    doc.documentElement.scrollLeft = scale === 1 ? 0 : Math.max(0, gesture.anchorX * scale - centerX);
  };
  const end = (event: TouchEvent) => { if (event.touches.length < 2) gesture = null; };
  // Disable browser viewport zoom; one-finger scrolling remains native.
  doc.documentElement.style.touchAction = 'pan-x pan-y';
  doc.documentElement.style.overflowX = 'auto';
  doc.body.style.overflow = 'visible';
  doc.addEventListener('touchstart', start, { passive: false });
  doc.addEventListener('touchmove', move, { passive: false });
  doc.addEventListener('touchend', end);
  doc.addEventListener('touchcancel', end);
  return () => {
    doc.removeEventListener('touchstart', start);
    doc.removeEventListener('touchmove', move);
    doc.removeEventListener('touchend', end);
    doc.removeEventListener('touchcancel', end);
  };
}
