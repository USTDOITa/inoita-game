import type {BattleStateKey} from './battle-semantics.ts';
import type {ItemInstance} from './items.ts';

/** 装备上的状态抗性正值表示免疫；只汇总目标自己的装备和镶嵌。 */
export function equipmentStateImmunity(equipped:readonly ItemInstance[],state:BattleStateKey):number {
  const option=state==='sleep'?'sleepResistance':state==='stun'?'stunResistance':undefined;
  if(!option)return 0;
  let value=0;
  for(const item of equipped)for(const modifier of [...item.numbers?.modifiers??[],...item.numbers?.gemModifiers??[]])
    if(modifier.stat===option)value+=modifier.value;
  return value;
}
