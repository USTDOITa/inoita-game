import assert from 'node:assert/strict';
import test from 'node:test';
import { LootPity, type PityConfig } from '../src/domain/loot-pity.ts';

const config: PityConfig = {
  equipment: { stepPermille: 60, capPermille: 900 },
  rare: { stepPermille: 40, capPermille: 600 },
  levelWindow: 10,
};

test('equipment and rare pity rise gradually, cap, and reset on a hit', () => {
  const pity = new LootPity();
  for (let index = 0; index < 5; index += 1) pity.recordEnemy('player', { equipment: false }, true);
  assert.equal(pity.equipmentBonus('player', config), 300);
  assert.equal(pity.rareBonus('player', config), 200);
  for (let index = 0; index < 100; index += 1) pity.recordEnemy('player', { equipment: false }, true);
  assert.equal(pity.equipmentBonus('player', config), config.equipment.capPermille);
  assert.equal(pity.rareBonus('player', config), config.rare.capPermille);
  pity.recordEnemy('player', { equipment: true, bestRarity: 2 }, true);
  assert.equal(pity.equipmentBonus('player', config), 0);
  assert.equal(pity.rareBonus('player', config), 0);
  pity.recordEnemy('player', { equipment: true, bestRarity: 1 }, true);
  assert.equal(pity.equipmentBonus('player', config), 0);
  assert.equal(pity.rareBonus('player', config), 40, '出了低稀有装备时只累计稀有保底');
});

test('kills outside the level window neither build nor clear pity', () => {
  const pity = new LootPity();
  pity.recordEnemy('player', { equipment: false }, false);
  assert.equal(pity.equipmentBonus('player', config), 0);
  pity.recordEnemy('player', { equipment: false }, true);
  pity.recordEnemy('player', { equipment: true, bestRarity: 2 }, false);
  assert.equal(pity.equipmentBonus('player', config), 60);
});

test('a boss first kill is guaranteed only once per save', () => {
  const pity = new LootPity();
  assert.equal(pity.takeBossFirstDefeat('enemy-boss'), true);
  assert.equal(pity.takeBossFirstDefeat('enemy-boss'), false);
  assert.equal(pity.bossDefeated('enemy-boss'), true);
});

test('chest pity is tracked per chest kind and survives a snapshot round-trip', () => {
  const pity = new LootPity();
  for (let index = 0; index < 4; index += 1) pity.recordChest('ordinary', { equipment: false });
  assert.equal(pity.chestEquipmentBonus('ordinary', config), 240);
  assert.equal(pity.chestEquipmentBonus('improved', config), 0);
  const saved = pity.captureState();
  const restored = new LootPity();
  restored.restoreState(saved);
  assert.equal(restored.chestEquipmentBonus('ordinary', config), 240);
  restored.recordChest('ordinary', { equipment: true });
  assert.equal(restored.chestEquipmentBonus('ordinary', config), 0);
});

test('leaving the party drops that member counters', () => {
  const pity = new LootPity();
  pity.recordEnemy('story-mercenary-olaf', { equipment: false }, true);
  assert.ok(pity.equipmentBonus('story-mercenary-olaf', config) > 0);
  pity.removeMember('story-mercenary-olaf');
  assert.equal(pity.equipmentBonus('story-mercenary-olaf', config), 0);
});
