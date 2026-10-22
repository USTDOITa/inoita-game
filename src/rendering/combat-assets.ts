import { resolveBasicAttack } from '../domain/basic-attack.ts';
import { enemySkills, type BattleCatalog, type BattleClass, type EnemyDefinition, type ResolvedBasicAttack } from '../domain/battle.ts';
import { BattleCharacter } from '../domain/character-stats.ts';
import type { ActorDefinition, Facing, WorldIndex } from '../domain/content.ts';
import type { ItemCatalog } from '../domain/items.ts';
import type { CompanionCatalog } from '../domain/party.ts';
import { costumeRecipe, type WardrobeCatalog } from '../domain/wardrobe.ts';
import { skillEffectNames, skillSummonNames } from '../domain/skill-action.ts';
import { basicAttackEffects, classEffects } from './combat-presenter.ts';
import { characterAssets } from './characters.ts';
import { effectAssets } from './effects.ts';
import { combatFeedbackAssets } from './combat-feedback.ts';
import { combatOutcomeAssets } from './combat-outcomes.ts';
import type { PendingAsset } from './scene-assets.ts';

/**
 * 战斗素材只由这里的纯函数决定：正式战斗和进图预取共用同一份清单，
 * 避免「预取漏了某项、演出结束后重建又要加载」。
 */
export function enemyCombatAssets(catalog: BattleCatalog, definition: EnemyDefinition): PendingAsset[] {
  const attack = definition.basicAttack ? resolveBasicAttack(catalog, { actor: definition.actor, basicAttack: definition.basicAttack }) : undefined;
  const effects = attack ? basicAttackEffects(catalog, attack) : {};
  for (const skill of enemySkills(definition)) for (const name of skillEffectNames(skill.action)) effects[name] = catalog.attackEffects[name];
  if (definition.commandAction) for (const name of skillEffectNames(definition.commandAction.action)) effects[name] = catalog.attackEffects[name];
  const summons = new Set(enemySkills(definition).flatMap(skill => skillSummonNames(skill.action)));
  const appearances = [...summons].flatMap(id => {
    const summoned = catalog.enemies.find(enemy => enemy.id === id)!;
    if (summoned.basicAttack) Object.assign(effects, basicAttackEffects(catalog, resolveBasicAttack(catalog, summoned)));
    for (const skill of enemySkills(summoned)) for (const name of skillEffectNames(skill.action)) effects[name] = catalog.attackEffects[name];
    if (summoned.commandAction) for (const name of skillEffectNames(summoned.commandAction.action)) effects[name] = catalog.attackEffects[name];
    return characterAssets(summoned.actor);
  });
  return [...characterAssets(definition.actor), ...appearances, ...effectAssets(effects)];
}

/** 职业可能召唤的敌人 id：技能里的召唤事件与战斗单位里的召唤。 */
export function classSummonEnemyIds(catalog: BattleCatalog, classId: string): string[] {
  const character = catalog.classes.find(value => value.id === classId);
  if (!character) return [];
  return [...new Set(character.skills.flatMap(skillId => {
    const action = catalog.skills[skillId]?.action;
    return action ? [...skillSummonNames(action), ...(action.combatUnits ?? []).flatMap(unit => unit.effect === 'summon' && unit.creature ? [unit.creature] : [])] : [];
  }))];
}

/** 装配后的普攻；装备只通过 hero.bag 读取，不依赖场景。 */
export function equipmentAttackFor(wardrobe: WardrobeCatalog, items: ItemCatalog, hero: BattleCharacter, actor: ActorDefinition, memberId = 'player'): ResolvedBasicAttack {
  const { attack } = costumeRecipe(wardrobe, items, hero.bag.equipmentItems(hero.bag.equipmentFor(memberId)));
  return resolveBasicAttack({ basicAttacks: { equipped: attack } }, {
    actor,
    basicAttack: { profileId: 'equipped', clips: { north: 'attack-north' as const, south: 'attack-south' as const, east: 'attack-east' as const, west: 'attack-west' as const } satisfies Record<Facing, string> }
  });
}

export interface PlayerCombatAssetInput {
  catalog: BattleCatalog;
  wardrobe: WardrobeCatalog;
  items: ItemCatalog;
  hero: BattleCharacter;
  actor: ActorDefinition;
}

/** 主角当前职业的全部战斗素材：职业特效、全部技能姿态、召唤物与技能图标。 */
export function playerCombatAssets({ catalog, wardrobe, items, hero, actor }: PlayerCombatAssetInput): PendingAsset[] {
  const character = catalog.classes.find(value => value.id === hero.classId);
  if (!character) throw new Error('主角职业缺少战斗定义');
  const effects = classEffects(catalog, character, equipmentAttackFor(wardrobe, items, hero, actor));
  for (const stance of Object.values(wardrobe.skillStances[hero.classId]))
    for (const action of Object.values(stance.actions)) if (action)
      for (const name of skillEffectNames(action)) effects[name] = catalog.attackEffects[name];
  const summonAssets = classSummonEnemyIds(catalog, hero.classId).flatMap(id => {
    const definition = catalog.enemies.find(enemy => enemy.id === id);
    if (!definition) throw new Error(`召唤物定义缺失：${id}`);
    return enemyCombatAssets(catalog, definition);
  });
  return [
    ...effectAssets(effects),
    ...summonAssets,
    ...character.skills.map(id => ({ kind: 'image' as const, key: catalog.skills[id].icon, file: catalog.skills[id].icon }))
  ];
}

/** 队伍成员的战斗素材；控制权可能切换，所以每个成员的技能图标与召唤物都要提前装好。 */
export function partyMemberCombatAssets(catalog: BattleCatalog, wardrobe: WardrobeCatalog, classId: string, actor: ActorDefinition): PendingAsset[] {
  const character: BattleClass | undefined = catalog.classes.find(value => value.id === classId);
  if (!character) return [];
  const effects = classEffects(catalog, character, resolveBasicAttack(catalog, { actor, basicAttack: character.basicAttack }));
  for (const profile of Object.values(wardrobe.dualWieldAttacks ?? {})) Object.assign(effects, basicAttackEffects(catalog, profile));
  const summonAssets = classSummonEnemyIds(catalog, classId).flatMap(id => {
    const enemy = catalog.enemies.find(value => value.id === id);
    if (!enemy) throw new Error(`伙伴召唤物不存在：${id}`);
    return enemyCombatAssets(catalog, enemy);
  });
  return [
    ...characterAssets(actor),
    ...effectAssets(effects),
    ...summonAssets,
    ...character.skills.map(id => ({ kind: 'image' as const, key: catalog.skills[id].icon, file: catalog.skills[id].icon }))
  ];
}

/**
 * 全部佣兵候选的战斗素材。佣兵可能被徽章招募或剧情加入，首次进游戏时一次装好，
 * 避免入队瞬间现场加载整套角色与技能特效。
 */
export function mercenaryCombatAssets(catalog:BattleCatalog,wardrobe:WardrobeCatalog,companions:CompanionCatalog,world:WorldIndex):PendingAsset[]{
  const assets=new Map<string,PendingAsset>();
  for(const definition of Object.values(companions.definitions)){
    const actor=world.actors[definition.actor];if(!actor)continue;
    for(const asset of partyMemberCombatAssets(catalog,wardrobe,definition.classId,actor))assets.set(asset.key,asset);
  }
  return [...assets.values()];
}

/** 所有地图共用、不随职业/装备变化的战斗素材。 */
export function sharedCombatAssets(catalog: BattleCatalog, wardrobe: WardrobeCatalog): PendingAsset[] {
  const effects = {} as Record<string, (typeof catalog.attackEffects)[string]>;
  for (const profile of Object.values(wardrobe.attacks)) Object.assign(effects, basicAttackEffects(catalog, profile));
  for (const profile of Object.values(wardrobe.dualWieldAttacks ?? {})) Object.assign(effects, basicAttackEffects(catalog, profile));
  for (const value of Object.values(catalog.statusAttackBuffs ?? {})) {
    const effect = value.applicationEffect;
    if (effect && catalog.attackEffects[effect]) effects[effect] = catalog.attackEffects[effect];
  }
  return [...combatOutcomeAssets(catalog), ...combatFeedbackAssets(catalog), ...effectAssets(effects)];
}
