import { expect, it } from 'vitest';
import { displayBounds } from './bounds';
it('fits root geometry and sized groups without treating parent-relative child positions as absolute', () => {
  expect(
    displayBounds([
      { position: { x: -100, y: 50 }, width: 220, height: 88 },
      { position: { x: 400, y: 200 }, width: 650, height: 450 },
      { parentId: 'function', position: { x: 25, y: 65 }, width: 220, height: 88 },
    ]),
  ).toEqual({ x: -100, y: 50, width: 1150, height: 600 });
  expect(displayBounds([])).toBeUndefined();
});
