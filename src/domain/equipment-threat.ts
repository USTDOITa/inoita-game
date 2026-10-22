import type {ItemInstance} from './items.ts';

/** 保留装备和宝石的有符号千分率，交由角色属性合并后统一钳位。 */
export function equipmentThreatReduction(equipped:readonly ItemInstance[]):number {
  let reduction=0;
  for(const item of equipped)for(const modifier of [...item.numbers?.modifiers??[],...item.numbers?.gemModifiers??[]])
    if(modifier.stat==='aggroReduction')reduction+=modifier.value;
  return reduction;
}
