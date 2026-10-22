import type { PrimaryAttributes } from './character-stats.ts';

/** 攻击力已经合并自身属性修改，但尚未乘物理、魔法或隐身伤害增幅。 */
export interface DamageAttributes {
  physicalAttack:number;
  magicAttack:number;
  physicalDamageRate:number;
  magicDamageRate:number;
  stealthDamageRate:number;
}

/** 普通物理伤害：先把物攻与当前物理增幅合并，再取整。 */
export function physicalNormalDamage(attributes:DamageAttributes):number {
  return Math.trunc(attributes.physicalAttack*(1000+attributes.physicalDamageRate+attributes.stealthDamageRate)/1000);
}

export function magicNormalDamage(attributes:DamageAttributes):number {
  return Math.trunc(attributes.magicAttack*(1000+attributes.magicDamageRate)/1000);
}

export function normalDamageForClass(attributes:DamageAttributes,classId:string|null):number {
  return classId==='warlock'||classId==='priest'?magicNormalDamage(attributes):physicalNormalDamage(attributes);
}

/** 技能的通常伤害基础取物理、魔法两条候选中较大的一个。 */
export function bestNormalDamage(attributes:DamageAttributes):number {
  const physical=physicalNormalDamage(attributes);
  const magical=magicNormalDamage(attributes);
  return Math.max(physical,magical);
}

/** 主角、伙伴、怪物和召唤物都提供自身完整属性。怪物及召唤物的基础五维为零。 */
export interface CombatActorAttributes extends DamageAttributes {
  maxHealth:number;
  primaryAttributes:PrimaryAttributes;
}

/** 技能公式可读取的来源；物攻保留未乘伤害增幅的值。 */
export interface ActionDamageSource {
  physicalAttack:number;
  magicAttack:number;
  maxHealth:number;
  bestNormalDamage:number;
  primaryAttributes:PrimaryAttributes;
}

export function actionDamageSource(actor:CombatActorAttributes):ActionDamageSource {
  return {
    physicalAttack:actor.physicalAttack,
    magicAttack:actor.magicAttack,
    maxHealth:actor.maxHealth,
    bestNormalDamage:bestNormalDamage(actor),
    primaryAttributes:{...actor.primaryAttributes},
  };
}
