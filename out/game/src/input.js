// Emberline — input: keyboard + mouse + pointer lock. Keeps the raw state;
// the sim reads it through the player module.
export function createInput(canvas) {
  const keys = {};
  const input = {
    keys,
    mouseDX: 0, mouseDY: 0,
    firing: false, adsHeld: false,
    locked: false,
    pressed: {}, // edge-triggered keys, consumed by the sim each step
    onLockChange: null,
    onFirstGesture: null,
  };
  let gestured = false;

  function gesture() {
    if (!gestured) { gestured = true; input.onFirstGesture && input.onFirstGesture(); }
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys[e.code] = true;
    input.pressed[e.code] = true;
    if (e.code === 'KeyM') input.pressed.KeyM = true;
    gesture();
    if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k of Object.keys(keys)) keys[k] = false; input.firing = false; });

  canvas.addEventListener('mousedown', (e) => {
    gesture();
    if (!input.locked) { canvas.requestPointerLock(); return; }
    if (e.button === 0) input.firing = true;
    if (e.button === 2) input.adsHeld = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.firing = false;
    if (e.button === 2) input.adsHeld = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked) input.firing = false;
    input.onLockChange && input.onLockChange(input.locked);
  });
  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.mouseDX += e.movementX;
    input.mouseDY += e.movementY;
  });

  input.consumeMouse = () => {
    const dx = input.mouseDX, dy = input.mouseDY;
    input.mouseDX = 0; input.mouseDY = 0;
    return [dx, dy];
  };
  input.consumePressed = () => {
    const p = input.pressed;
    input.pressed = {};
    return p;
  };
  input.lock = () => canvas.requestPointerLock();
  return input;
}
