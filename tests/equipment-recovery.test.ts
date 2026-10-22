import assert from 'node:assert/strict';
import test from 'node:test';
import {equipmentRecoveryModifiers} from '../src/domain/equipment-recovery.ts';
import type {ItemInstance} from '../src/domain/items.ts';

test('physical drain and mana recovery combine only the equipped item and gem modifiers',()=>{
  const equipped=[{numbers:{modifiers:[{stat:'lifeSteal',value:35},{stat:'manaRegen',value:2}],gemModifiers:[{stat:'lifeSteal',value:15},{stat:'physicalAttackRate',value:100}]}},
    {numbers:{modifiers:[{stat:'manaRegen',value:3},{stat:'spellExpert',value:30}],gemModifiers:[]}}] as ItemInstance[];
  assert.deepEqual(equipmentRecoveryModifiers(equipped),{lifeDrainPerThousand:50,manaRecoveryPerPulse:5,manaCostReductionRate:30});
  assert.deepEqual(equipmentRecoveryModifiers([]),{lifeDrainPerThousand:0,manaRecoveryPerPulse:0,manaCostReductionRate:0});
});
