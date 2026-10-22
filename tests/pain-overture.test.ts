import {dispatchFrame} from './support/combat-driver.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import test from 'node:test';
import type {BattleCatalog,NumericCombatUnit,BattleBuffEffect,ActionDispatchDefinition} from '../src/domain/battle.ts';
import type {BattleBuffKey} from '../src/domain/battle-semantics.ts';
import {CombatCooldownStore} from '../src/domain/combat-cooldowns.ts';
import {CombatController,type Combatant,type CombatPort} from '../src/domain/combat.ts';
import {CombatConditions} from '../src/domain/combat-conditions.ts';

const phaser=registerHooks({resolve(specifier,context,next){
  return specifier==='phaser'?{url:'data:text/javascript,export default {BlendModes:{},Scene:class{},Physics:{Arcade:{Body:class{}}}}',shortCircuit:true}:next(specifier,context);
}});
const {WorldCombat}=await import('../src/scenes/world-combat.ts');
const {CombatPresenter}=await import('../src/rendering/combat-presenter.ts');phaser.deregister();
const method=(name:string)=>Reflect.get(WorldCombat.prototype,name);

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const action=catalog.skills['pain-overture'].action!;
const selfDamage=action.combatUnits![0] as NumericCombatUnit;
const buffUnit=action.combatUnits![1] as {effect:'buff';buff:string;ranks:{strength:number;effect:{maxStacks?:number;
  simulationFrames?:{lastActiveFrame:number};modifiers:{attribute:string;operation:{kind:string;amount?:number}}[];
  onApply?:unknown[]}}[]};
const manaAmounts=[18,24,30,36,39,42,45,48];
const selftDamageRates=[50,50,50,50,50,50,50,50];

test('the self damage is a named direct hit on the frame clock and the buff carries an immediate mana amount',()=>{
  assert.equal(selfDamage.effect,'self-damage');
  assert.equal(selfDamage.source,'maxHealth');
  assert.equal(selfDamage.alsoAppliesLearnedBuff,'blood-revenge');
  selfDamage.ranks.forEach((rank,index)=>assert.deepEqual(rank.operation,
    {kind:'multiply-thousandth',ratePerThousand:selftDamageRates[index]},`rank ${index+1}`));
  assert.equal(action.minHealthRatePerThousand,50,'5% 按千分率记');
  assert.equal(action.requiresTarget,false);
  buffUnit.ranks.forEach((rank,index)=>{
    const effect=rank.effect;
    assert.deepEqual(effect.modifiers,[{attribute:'maxMana',operation:{kind:'add',amount:manaAmounts[index]}}],`rank ${index+1}`);
    assert.deepEqual(effect.onApply,[{kind:'add-mana',value:manaAmounts[index]}],`rank ${index+1}`);
    assert.deepEqual(effect.simulationFrames,{lastActiveFrame:90});
    assert.equal(effect.maxStacks,1);
  });
});

function fixture(deepRank=0,health=500,maxHealth=1000){
  const order:string[]=[];
  let host:Record<string,unknown>;
  // 和正式装配一样挂上资源端口，接受结果才会走到「立即加 MP」。
  const conditions=new CombatConditions({
    captureResourceCapacities:()=>({maxHealth,maxMana:100}),
    onApply:(id,effect,entry)=>method('applyBuffResources').call(host,id,effect,entry),
  });
  const fighter={level:1,physicalAttack:0,magicAttack:0,baseDefense:0,defense:0,defenseRate:0,maxHealth,maxMana:100,
    hitBase:0,hitBonus:0,evasionBase:0,evasionBonus:0,criticalRate:0,criticalResistance:0,criticalDamage:0,
    criticalDamageResistance:0,weaponBlock:0,shieldBlock:0,physicalResistance:0,magicResistance:0};
  const member={classId:'warlock',player:{health,maxHealth,mana:10,maxMana:100},
    bag:{equipmentFor:()=>({}),get:()=>undefined},
    panel:{attributes:{strength:0,dexterity:0,vitality:0,intelligence:0,mentality:0}},
    setHealth:(value:number)=>{member.player.health=Math.max(0,value);order.push(`health:${member.player.health}`);},
    setMana:(value:number)=>{member.player.mana=value;order.push(`mana:${value}`);},
    skills:{draft:()=>({levels:deepRank?{'blood-revenge':deepRank}:{}})}};
  const deaths:{health:number;mana:number;buffs:string[]}[]=[];
  const caster:Combatant={id:'player',team:'party',position:{x:0,y:0},bounds:{x:-4,y:-4,width:8,height:8}};
  host=Object.setPrototypeOf({app:{battleCatalog:catalog,session:{skills:member.skills},audio:{effect:(key:string)=>order.push(`sound:${key}`)}},
    controlledId:'player',
    conditions,arena:[],activeParty:['player'],fallen:new Set(),pendingDefeats:new Set(),allies:[],
    playAction:(presenter:{play:(...args:unknown[])=>()=>void},...args:unknown[])=>presenter.play(...args),
    presentActionFrame:(presenter:object,...args:Parameters<typeof dispatchFrame> extends [object,...infer Rest]?Rest:never)=>dispatchFrame(presenter,...args),
    hero:{level:10},memberOf:(id:string)=>id==='player'?member:undefined,partyPassives:()=>[],
    partyFighter:()=>fighter,enemyFighter:()=>fighter,
    actorAttributes:()=>({physicalAttack:0,magicAttack:0,maxHealth,physicalDamageRate:0,magicDamageRate:0,
      stealthDamageRate:0,primaryAttributes:{strength:0,dexterity:0,vitality:0,intelligence:0,mentality:0}}),
    readResourceCapacity:(_id:string,key:string)=>key==='maxMana'?100:maxHealth,
    actorAttribute:(_id:string,key:string)=>key==='maxHealth'?maxHealth:key==='maxMana'?100:0,
    combatant:()=>({position:{x:0,y:0}}),
    applyStateConsequences:()=>{},syncCombatResourceLimits:()=>{},showBuffApplication:()=>{},
    applyActorBuff:(id:string,key:BattleBuffKey,priority:number,effect:BattleBuffEffect,sourceId:string)=>{
      const accepted=method('applyActorBuff').call(host,id,key,priority,effect,sourceId);
      if(accepted)order.push(`buff:${key}`);return accepted;
    },
    resolveHitReactions:()=>order.push('hit-reactions'),showHit:()=>order.push('hit-feedback'),attackProc:()=>order.push('attack-proc'),
    memberDefeated:(id:string)=>{order.push('defeat');deaths.push({health:member.player.health,mana:member.player.mana,
      buffs:conditions.snapshot(id).map(buff=>buff.id)});(host.fallen as Set<string>).add(id);conditions.clear();},
    dropMana:()=>{},summonOwnerReactions:()=>{},
    presenterFor:()=>({showEffects:()=>{}})},
    WorldCombat.prototype);
  const unit=(cueIndex:number)=>method('skillUnit').call(host,{casterId:'player',targetId:'player',cueIndex,
    skill:{id:'pain-overture',level:1,action}});
  const applyRank=(rank:number)=>method('applyActorBuff').call(host,'player','pain-overture',
    buffUnit.ranks[rank]!.strength,buffUnit.ranks[rank]!.effect,'player');
  const select=()=>method('canSelectSkill').call(host,'player',{id:'pain-overture',level:1,action});
  const presenter=Object.setPrototypeOf({pose:()=>{},visualEffect:(cue:{effect:string})=>order.push(`effect:${cue.effect}`),
    visual:()=>({container:{active:true,...caster.position}})},CombatPresenter.prototype);
  let frame=(_index:number)=>{};
  const port:CombatPort={cooldowns:new CombatCooldownStore(()=>0).forActor('player'),
    actor:id=>id==='player'&&!(host.fallen as Set<string>).has(id)?caster:undefined,candidates:()=>[caster],
    facing:()=> 'east',face:()=>{},moveToward:()=>{},stop:()=>{},canStand:()=>true,relocate:()=>{},clearEffects:()=>{},
    canSelectSkill:()=>select(),canSpendMana:()=>true,spendMana:()=>true,
    play:(_value,onFrame)=>{frame=onFrame;return ()=>{};},
    frame:(value,index,contact,ready)=>dispatchFrame(presenter,value,index,contact,ready,undefined,
      (definition:ActionDispatchDefinition,work:()=>void,after?:()=>void)=>method('runActionDispatch').call(host,value,definition,work,after)),
    unit:hit=>{order.push(`unit:${hit.cueIndex}`);return method('skillUnit').call(host,hit);}};
  const combat=new CombatController('player',null,port);
  return {conditions,member,order,unit,cast:unit,applyRank,select,deaths,
    start:()=>combat.requestManualSkill({id:'pain-overture',level:1,action,manaCost:0}),frame:(index:number)=>frame(index)};
}

test('the self damage subtracts the full amount with no hit roll or combat reaction',()=>{
  const run=fixture();
  assert.equal(run.unit(0),'success');
  assert.equal(run.member.player.health,450);
  assert.deepEqual(run.order,['health:450','hit-feedback'],'直接伤害结算含反馈，但不过命中、暴击与成功反应');
});

test('a learned Blood Revenge stacks on the caster right after the self damage',()=>{
  const run=fixture(8);
  assert.equal(run.unit(0),'success');
  assert.equal(run.member.player.health,450);
  assert.equal(run.conditions.attribute('player','physicalDamageRate',0),77);
  assert.equal(run.conditions.snapshot('player')[0]?.sourceId,'player');
});

test('the accepted buff adds mana immediately and a weaker one does not',()=>{
  const run=fixture();
  assert.equal(run.member.player.mana,10);
  assert.equal(run.cast(1),'success','第二个单元才是增益');
  assert.equal(run.member.player.mana,28,'一级接受后立即 +18');
  assert.equal(run.conditions.buffLifetimeFrames('player','pain-overture'),90);
  // 同级刷新仍然立即加一次，层数保持单层。
  assert.equal(run.cast(1),'success');
  assert.equal(run.member.player.mana,46);
  assert.equal(run.conditions.snapshot('player').length,1);
  // 更低等级被拒：不加 MP，增益保持原样。
  assert.equal(run.applyRank(7),true);
  const before=run.member.player.mana;
  assert.equal(run.applyRank(0),false,'八级在身时一级被拒');
  assert.equal(run.member.player.mana,before);
});

test('the cast gate refuses exactly at five percent of maximum health',()=>{
  for(const [health,allowed] of [[50,false],[51,true],[500,true]] as const)
    assert.equal(fixture(0,health).select(),allowed,`HP ${health}`);
});


test('the actual dispatch rejects immune self damage but still applies both buffs and immediate mana',()=>{
  const run=fixture(8);
  assert.equal(run.start(),'started');
  run.conditions.applyState('player','damage-immune',1000);
  run.conditions.applyState('player','sleep',1000);
  run.frame(3);
  assert.equal(run.member.player.health,500);
  assert.equal(run.member.player.mana,28);
  assert.equal(run.conditions.hasState('player','sleep'),true,'未接受伤害时不唤醒');
  assert.equal(run.conditions.attribute('player','physicalDamageRate',0),77);
  assert.deepEqual(run.order,['effect:skeletal-claw','unit:0','buff:blood-revenge','unit:1','mana:28','buff:pain-overture','sound:A_Skill_01']);
  assert.deepEqual(run.deaths,[]);
});

test('accepted direct self damage wakes sleep without rolling or invoking success reactions',t=>{
  t.mock.method(Math,'random',()=>{throw new Error('吟唱自伤不掷命中或暴击');});
  const run=fixture();
  run.conditions.applyState('player','sleep',1000);
  assert.equal(run.unit(0),'success');
  assert.equal(run.member.player.health,450);
  assert.equal(run.conditions.hasState('player','sleep'),false);
  assert.deepEqual(run.order,['health:450','hit-feedback']);
});

test('self damage that becomes lethal after cast selection finishes the complete dispatch before defeat',()=>{
  const run=fixture(8,51);
  assert.equal(run.start(),'started','起手时生命严格高于 5%');
  run.member.player.health=40;
  run.frame(3);
  assert.deepEqual(run.order,['effect:skeletal-claw','unit:0','health:0','hit-feedback','buff:blood-revenge',
    'unit:1','mana:28','buff:pain-overture','sound:A_Skill_01','defeat']);
  assert.deepEqual(run.deaths,[{health:0,mana:28,buffs:['blood-revenge','pain-overture']}]);
  assert.equal(run.member.player.health,0,'后续回魔没有复活施法者');
  assert.deepEqual(run.conditions.snapshot('player'),[],'死亡完成后清理增益');
  run.frame(3);
  assert.equal(run.deaths.length,1);
});
