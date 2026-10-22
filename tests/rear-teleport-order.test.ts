import test from 'node:test';
import assert from 'node:assert/strict';
import { planRearTeleport } from '../src/domain/rear-teleport.ts';
import type { Combatant } from '../src/domain/combat.ts';
import type { Facing } from '../src/domain/content.ts';

const bounds = { x: -8, y: -8, width: 16, height: 16 };
const caster: Combatant = { id: 'player', team: 'party', position: { x: 256, y: 192 }, bounds };
const position = { x: 320, y: 192 };

test('黑暗奇袭背后和第一侧受阻时，优先选择另一侧而非正面', () => {
  const cases: { facing: Facing; available: (x: number, y: number) => boolean; expected: { x: number; y: number } }[] = [
    { facing: 'north', available: (x, y) => x > 328 || y < 184, expected: { x: 344, y: 192 } },
    { facing: 'east', available: (x, y) => x > 328 || y > 200, expected: { x: 320, y: 216 } },
    { facing: 'south', available: (x, y) => x < 312 || y > 200, expected: { x: 296, y: 192 } },
    { facing: 'west', available: (x, y) => x < 312 || y < 184, expected: { x: 320, y: 168 } },
  ];
  for (const { facing, available, expected } of cases) {
    const target: Combatant = { id: 'enemy', team: 'hostile', position, bounds, facing };
    assert.deepEqual(planRearTeleport(caster, target, p => available(p.x, p.y), () => true), expected, facing);
    assert.deepEqual(planRearTeleport(caster, target, () => true, p => available(p.x, p.y)), expected, `${facing}: path`);
  }
});

test('黑暗奇袭候选格点顺序与原指令回放一致，纵向只检查首选点', () => {
  const target: Combatant = { id: 'enemy', team: 'hostile', position, bounds, facing: 'north' };
  const checked: { x: number; y: number }[] = [];
  assert.equal(planRearTeleport(caster, target, point => { checked.push(point); return false; }, () => true), undefined);
  assert.deepEqual(checked, [
    { x: 320, y: 216 }, { x: 296, y: 192 }, { x: 304, y: 192 },
    { x: 344, y: 192 }, { x: 336, y: 192 }, { x: 328, y: 192 }, { x: 320, y: 192 },
    { x: 320, y: 168 },
  ]);
  assert.equal(planRearTeleport(caster, target, point => point.x === 312 && point.y === 216, () => true), undefined);
});

test('黑暗奇袭按八像素向下取整并使用非对称碰撞矩形', () => {
  const checked: { x: number; y: number }[] = [];
  const target: Combatant = { id: 'enemy', team: 'hostile', position: { x: 323, y: 195 }, bounds, facing: 'north' };
  assert.deepEqual(planRearTeleport(caster, target, () => true, () => true), { x: 320, y: 216 });
  const asymmetricCaster = { ...caster, bounds: { x: -5, y: -12, width: 13, height: 20 } };
  const asymmetricTarget = { ...target, position, bounds: { x: -12, y: -16, width: 24, height: 32 } };
  planRearTeleport(asymmetricCaster, asymmetricTarget, point => { checked.push(point); return false; }, () => true);
  assert.deepEqual(checked, [
    { x: 320, y: 224 }, { x: 288, y: 192 }, { x: 296, y: 192 },
    { x: 344, y: 192 }, { x: 336, y: 192 }, { x: 328, y: 192 }, { x: 320, y: 192 },
    { x: 320, y: 160 },
  ]);
});

test('黑暗奇袭扫描范围夹到地图边界，每区第一个可站点不可达便换方向', () => {
  const checked: { x: number; y: number }[] = [];
  const target: Combatant = { id: 'enemy', team: 'hostile', position: { x: 24, y: 24 }, bounds, facing: 'north' };
  planRearTeleport(caster, target, point => { checked.push(point); return false; }, () => true,
    { x: 0, y: 0, width: 32, height: 32 });
  assert.deepEqual(checked, [
    { x: 24, y: 48 }, { x: 0, y: 24 }, { x: 8, y: 24 },
    { x: 48, y: 24 }, { x: 40, y: 24 }, { x: 24, y: 0 },
  ]);
  checked.length = 0;
  planRearTeleport(caster, { ...target, position }, () => true, point => { checked.push(point); return false; });
  assert.deepEqual(checked, [
    { x: 320, y: 216 }, { x: 296, y: 192 }, { x: 344, y: 192 }, { x: 320, y: 168 },
  ]);
});
