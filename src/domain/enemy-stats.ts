import type { EnemyDefinition } from './battle.ts';

export const MAX_ENEMY_LEVEL = 107;
/** 比率统一用千分数：100 表示 10%。 */
export interface EnemyAttributes {
  maxMana:number;
  physicalAttack:number; magicAttack:number;
  defense:number; defenseRate:number;
  physicalResistanceBonus:number; magicResistance:number;
  hitBonus:number; evasionBonus:number;
  criticalRate:number; criticalResistance:number; criticalDamageResistance:number; criticalDamage:number;
  weaponBlock:number; shieldBlock:number;
}
interface EnemyStats extends EnemyAttributes {
  level:number; sceneLevel:boolean; elite:boolean; partySize:number;
  maxHealth:number; hitBase:number; evasionBase:number;
  hitRate:number; evasionRate:number; physicalResistance:number;
  /** 原版基础经验，以及按存活人数和主角等级差修正后的预览。 */
  baseExperience:number; experience:number;
}
export interface EnemySnapshot extends EnemyStats { id:string; name:string; health:number; mana:number }
interface EnemyStatsOptions { level?:number; sceneLevel?:number; elite?:boolean; partySize?:number; playerLevel?:number }

function enemyLevel(value:number):number {
  if(!Number.isInteger(value)||value<1||value>MAX_ENEMY_LEVEL)throw new Error(`怪物等级需要是 1–${MAX_ENEMY_LEVEL} 的整数`);
  return value;
}
export function enemyPartySize(value:number):number {
  if(!Number.isInteger(value)||value<1||value>3)throw new Error('模拟队伍人数需要是 1–3 的整数');
  return value;
}
/** 读取原版基础值后依次应用精英、队伍和显示公式；不修改内容定义。 */
export function calculateEnemy(definition:EnemyDefinition,options:EnemyStatsOptions={}):Readonly<EnemyStats> {
  const level=enemyLevel(options.level??definition.level??options.sceneLevel??1);
  const partySize=enemyPartySize(options.partySize??1),elite=options.elite??false;
  const playerLevel=options.playerLevel??1;
  if(!Number.isInteger(playerLevel)||playerLevel<1||playerLevel>105)throw new Error('主角等级需要是 1–105 的整数');
  const attrs=definition.attributes,trunc=Math.trunc;
  const eliteHealth=elite?trunc(definition.maxHealth*360/100):definition.maxHealth;
  const elitePhysical=elite?trunc(attrs.physicalAttack*120/100):attrs.physicalAttack;
  const magicAttack=elite?trunc(attrs.magicAttack*120/100):attrs.magicAttack;
  const partyPercent=100+20*(partySize-1);
  const maxHealth=trunc(eliteHealth*partyPercent/100),physicalAttack=trunc(elitePhysical*partyPercent/100);
  const hitBase=level*4+40,evasionBase=level+10;
  const hitRate=trunc((hitBase*1000+20000)/(hitBase+level+35))+Math.max(0,attrs.hitBonus)+100;
  const evasionBonus=Math.min(750,attrs.evasionBonus);
  const evasionRate=Math.min(750,1000+evasionBonus-trunc((5000*level+1000000)/(5*level+evasionBase+1200)));
  const defense=trunc(attrs.defense*(1000+attrs.defenseRate)/1000);
  const physicalResistance=trunc(1000*defense/(defense+20*(level+3)))+attrs.physicalResistanceBonus;
  const baseExperience=attrs.physicalAttack*10+definition.maxHealth;
  const partyExperience=trunc(baseExperience*(100-20*(partySize-1))/100);
  const experience=partyExperience<1?0:trunc(partyExperience*(10+Math.max(-8,Math.min(5,level-playerLevel)))/10);
  return Object.freeze({...attrs,level,sceneLevel:options.level===undefined&&definition.level===null,elite,partySize,
    maxHealth,physicalAttack,magicAttack,defense,hitBase,evasionBase,hitRate,evasionBonus,evasionRate,
    physicalResistance,magicResistance:Math.min(750,attrs.magicResistance),baseExperience,experience});
}
