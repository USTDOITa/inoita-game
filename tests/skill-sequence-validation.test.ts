import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleCatalog} from '../src/domain/battle.ts';
import {parseBattle} from '../src/application/content-validation.ts';
const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
test('first unit establishes a target list and failure feedback requires an arrival',()=>{
  const data=structuredClone(catalog),event=data.skills['dark-strike'].action!.events.find(e=>e.kind==='units')!;
  assert.equal(event.kind,'units');if(event.kind!=='units')return;
  event.cues[0].targetSelection='reuse-previous';
  assert.throws(()=>parseBattle(data),/首个单元/);
  event.cues[0].targetSelection='search';event.cues[0].unitFeedbackPolicy='always';
  assert.throws(()=>parseBattle(data),/失败反馈策略/);
});
