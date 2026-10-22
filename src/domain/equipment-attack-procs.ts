import type {ItemInstance} from './items.ts';

const optionAttributes={
  fire:'fireSplashChance',wind:'windStrikeChance',freeze:'frostStrikeChance',
  divine:'divineStrikeChance',darkness:'darknessStrikeChance',poison:'poisonStrikeChance',
} as const;
type EquipmentAttackProcRates=Record<typeof optionAttributes[keyof typeof optionAttributes],number>;

/** 使用已生成的实例和宝石词条；有符号阈值由宿主合并其它来源后钳位。 */
export function equipmentAttackProcs(equipped:readonly ItemInstance[]):EquipmentAttackProcRates {
  const rates:EquipmentAttackProcRates={fireSplashChance:0,windStrikeChance:0,frostStrikeChance:0,
    divineStrikeChance:0,darknessStrikeChance:0,poisonStrikeChance:0};
  for(const item of equipped)for(const modifier of [...item.numbers?.modifiers??[],...item.numbers?.gemModifiers??[]]){
    if(!Object.hasOwn(optionAttributes,modifier.stat))continue;
    rates[optionAttributes[modifier.stat as keyof typeof optionAttributes]]+=modifier.value;
  }
  return rates;
}
