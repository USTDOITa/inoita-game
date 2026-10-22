import test from 'node:test';
import assert from 'node:assert/strict';
import {executeBloodThirstReaction,resolveSkillReactions,skillReactionEffects,type SkillReaction,type SkillReactionBuff,type SkillReactionEvent,
  type SkillReactionCommand,type SkillReactionPorts} from '../src/domain/skill-reactions.ts';
import type {SkillDefinition} from '../src/domain/battle.ts';

const buff=(key:SkillReactionBuff['key'],rankPriority=1):SkillReactionBuff=>({key,rankPriority,
  effect:{durationMs:5000,tickMs:0,maxStacks:1,modifiers:[],states:[],periodic:[]}});
const soul=(chanceThreshold=40):SkillReaction=>({kind:'soul-sword',chanceThreshold,
  buffFromLearnedSkill:'dark-strike',physicalEffects:['soul-sword'],magicEffects:['soul-sword-magic','soul-sword']});
const blood:SkillReaction={kind:'blood-sword',lifeDrainPerThousand:50};
const shield:SkillReaction={kind:'shield-of-rage',buff:buff('shield-of-rage')};
const flames=(chanceThreshold=300):SkillReaction=>({kind:'flares-of-pain',chanceThreshold,buff:buff('flares-of-pain')});
const wrath=(chanceThreshold=120):SkillReaction=>({kind:'wrath-of-darkness',chanceThreshold,buff:buff('wrath-of-darkness')});
const hit:Extract<SkillReactionEvent,{kind:'attack-success'}>={kind:'attack-success',ownerId:'attacker',
  opponentId:'defender',damageKind:'physical',outcome:'hit',hitDamage:100,otherLifeDrainPerThousand:0};
const attackEffects:Extract<SkillReactionEvent,{kind:'attack-effects'}>={kind:'attack-effects',ownerId:'attacker',
  opponentId:'defender',damageKind:'physical',outcome:'hit',actionId:'firestorm',hasMoltenArmor:false};
const physicalEffects:Extract<SkillReactionEvent,{kind:'physical-attack-effects'}>={kind:'physical-attack-effects',
  ownerId:'attacker',opponentId:'defender',damageKind:'physical',outcome:'hit',armorBreakChance:260};
const bloodThirst:Extract<SkillReactionEvent,{kind:'blood-thirst'}>={kind:'blood-thirst',ownerId:'attacker',
  opponentId:'defender',damageKind:'physical',outcome:'hit',hitDamage:101,chanceThreshold:200};
const revenge:Extract<SkillReactionEvent,{kind:'physical-revenge'}>={kind:'physical-revenge',ownerId:'defender',
  opponentId:'attacker',damageKind:'physical',outcome:'hit',chanceThreshold:100};
const instinct:Extract<SkillReactionEvent,{kind:'physical-instinct'}>={kind:'physical-instinct',ownerId:'attacker',
  opponentId:'defender',damageKind:'physical',outcome:'hit',chanceThreshold:10,mainHandTwoHanded:false};
const ports=(roll=1,learnedBuff:SkillReactionPorts['learnedBuff']=()=>undefined)=>{
  let draws=0;
  return {random:()=>{draws++;return (roll-.5)/999;},learnedBuff,draws:()=>draws};
};

test('reaction probabilities use a strict 1–999 threshold and skip nonpositive chances',()=>{
  for(const [threshold,roll,triggered,draws] of [
    [-1,1,false,0],[0,1,false,0],[1,1,false,1],[40,39,true,1],[40,40,false,1],
    [999,999,false,1],[1000,999,true,1],
  ] as const){
    const input=ports(roll);
    assert.equal(resolveSkillReactions([soul(threshold)],hit,input).length>0,triggered);
    assert.equal(input.draws(),draws);
  }
});

test('soul sword reads the currently learned dark strike only after its roll succeeds',()=>{
  let learned=buff('dark-strike',1);
  const seen:string[]=[];
  const input=ports(1,(owner,skill)=>{seen.push(`${owner}/${skill}`);return learned;});
  const first=resolveSkillReactions([soul()],hit,input);
  assert.deepEqual(first,[{kind:'apply-buff',sourceId:'attacker',targetId:'attacker',buff:learned},
    {kind:'play-effect',targetId:'attacker',effect:'soul-sword'}]);
  learned=buff('dark-strike',8);
  const second=resolveSkillReactions([soul()],hit,input);
  assert.equal(second[0]?.kind,'apply-buff');
  if(second[0]?.kind==='apply-buff')assert.strictEqual(second[0].buff,learned);
  assert.deepEqual(seen,['attacker/dark-strike','attacker/dark-strike']);
  resolveSkillReactions([soul(0)],hit,input);
  assert.equal(seen.length,2);
});

test('unlearned dark strike retains soul sword visuals, including the magic effect order',()=>{
  assert.deepEqual(resolveSkillReactions([soul()],{...hit,damageKind:'magic'},ports()),[
    {kind:'play-effect',targetId:'attacker',effect:'soul-sword-magic'},
    {kind:'play-effect',targetId:'attacker',effect:'soul-sword'},
  ]);
});

test('physical life drain adds equipment and skill rates before the single truncation',()=>{
  const result=resolveSkillReactions([blood],{...hit,hitDamage:15,otherLifeDrainPerThousand:50},ports());
  assert.deepEqual(result,[{kind:'restore-health',targetId:'attacker',amount:1},
    {kind:'play-effect',targetId:'attacker',effect:'life-drain'}]);
  assert.deepEqual(resolveSkillReactions([blood],{...hit,damageKind:'magic'},ports()),[]);
  assert.equal(resolveSkillReactions([], {...hit,otherLifeDrainPerThousand:100},ports())[0]?.kind,'restore-health');
});

test('positive life drain still emits its effect when the resulting heal rounds to zero',()=>{
  assert.deepEqual(resolveSkillReactions([blood],{...hit,hitDamage:1},ports()),[
    {kind:'restore-health',targetId:'attacker',amount:0},
    {kind:'play-effect',targetId:'attacker',effect:'life-drain'},
  ]);
  assert.deepEqual(resolveSkillReactions([blood],{...hit,otherLifeDrainPerThousand:-50},ports()),[]);
});

test('physical blocks keep attacker reactions; misses and magic shield blocks skip them',()=>{
  for(const outcome of ['weapon-block','shield-block'] as const){
    const result=resolveSkillReactions([blood,soul()],{...hit,outcome},ports());
    assert.deepEqual(result.map(command=>command.kind),['play-effect','restore-health','play-effect']);
  }
  for(const event of [{...hit,outcome:'miss'}, {...hit,damageKind:'magic',outcome:'shield-block'}] as const){
    const input=ports();
    assert.deepEqual(resolveSkillReactions([soul(),blood],event,input),[]);
    assert.equal(input.draws(),0);
  }
});

test('shield of rage uses the defender as both source and target without drawing a chance',()=>{
  const input=ports();
  assert.deepEqual(resolveSkillReactions([shield],{kind:'physical-block',ownerId:'defender'},input),[
    {kind:'apply-buff',sourceId:'defender',targetId:'defender',buff:shield.buff},
  ]);
  assert.equal(input.draws(),0);
  assert.deepEqual(resolveSkillReactions([shield],hit,input),[]);
});

test('flares of pain draws before its firestorm or molten armor condition',()=>{
  const input=ports();
  assert.deepEqual(resolveSkillReactions([flames()],{...attackEffects,actionId:'dark-strike'},input),[]);
  assert.equal(input.draws(),1);
  const active=flames();
  assert.equal(active.kind,'flares-of-pain');
  if(active.kind!=='flares-of-pain')throw new Error('fixture');
  for(const event of [attackEffects,{...attackEffects,damageKind:'magic'},
    {...attackEffects,actionId:'basic-attack',hasMoltenArmor:true}] as const){
    assert.deepEqual(resolveSkillReactions([active],event,input),[
      {kind:'apply-buff',sourceId:'attacker',targetId:'defender',buff:active.buff},
    ]);
  }
  const zero=ports();
  assert.deepEqual(resolveSkillReactions([flames(0)],attackEffects,zero),[]);
  assert.equal(zero.draws(),0);
});

test('molten armor reflection reverses the source and target of flares of pain',()=>{
  const active=flames();
  if(active.kind!=='flares-of-pain')throw new Error('fixture');
  assert.deepEqual(resolveSkillReactions([active],{
    kind:'molten-reflection-completed',ownerId:'defender',opponentId:'attacker',
  },ports()),[{kind:'apply-buff',sourceId:'defender',targetId:'attacker',buff:active.buff}]);
});

test('wrath of darkness occurs only in the late physical received phase',()=>{
  const active=wrath();
  if(active.kind!=='wrath-of-darkness')throw new Error('fixture');
  const input=ports();
  assert.deepEqual(resolveSkillReactions([active],hit,input),[]);
  assert.equal(input.draws(),0);
  assert.deepEqual(resolveSkillReactions([active],{kind:'physical-hit-received',ownerId:'defender'},input),[
    {kind:'apply-buff',sourceId:'defender',targetId:'defender',buff:active.buff},
  ]);
  assert.equal(input.draws(),1);
  const zero=ports();
  assert.deepEqual(resolveSkillReactions([wrath(0)],{kind:'physical-hit-received',ownerId:'defender'},zero),[]);
  assert.equal(zero.draws(),0);
});

test('separate phases preserve source ownership and do not trigger unrelated passives',()=>{
  const all=[blood,wrath(),flames(),shield,soul()];
  const input=ports();
  assert.deepEqual(resolveSkillReactions(all,hit,input).map(command=>command.kind),
    ['play-effect','restore-health','play-effect']);
  assert.equal(input.draws(),1);
  assert.equal(resolveSkillReactions(all,attackEffects,input).length,1);
  assert.equal(input.draws(),2);
  assert.equal(resolveSkillReactions(all,{kind:'physical-hit-received',ownerId:'defender'},input).length,1);
  assert.equal(input.draws(),3);
});

test('dark sense applies only to the breaking actor without rolling unrelated reactions',()=>{
  const currentBuff=buff('dark-sense',6);
  const reactions:SkillReaction[]=[soul(),blood,shield,flames(),wrath(),{kind:'dark-sense',buff:currentBuff}];
  const input:SkillReactionPorts={
    random:()=>assert.fail('action stealth break does not draw a chance'),
    learnedBuff:()=>assert.fail('dark sense already carries its learned buff definition'),
  };
  for(const ownerId of ['player','companion-assassin']){
    assert.deepEqual(resolveSkillReactions(reactions,{kind:'action-stealth-break',ownerId},input),[
      {kind:'apply-buff',sourceId:ownerId,targetId:ownerId,buff:currentBuff},
    ]);
  }
  assert.deepEqual(resolveSkillReactions(reactions.slice(0,-1),{
    kind:'action-stealth-break',ownerId:'player',
  },input),[]);
});

test('dark sense does not react to attack, block or received-damage events',()=>{
  const reaction:SkillReaction={kind:'dark-sense',buff:buff('dark-sense')};
  const events:SkillReactionEvent[]=[hit,attackEffects,{kind:'physical-block',ownerId:'caster'},
    {kind:'molten-reflection-completed',ownerId:'caster',opponentId:'opponent'},
    {kind:'physical-hit-received',ownerId:'caster'}];
  const input:SkillReactionPorts={
    random:()=>assert.fail('an unrelated event does not draw for dark sense'),
    learnedBuff:()=>assert.fail('an unrelated event does not resolve a learned buff'),
  };
  for(const event of events)assert.deepEqual(resolveSkillReactions([reaction],event,input),[]);
});

test('armor penetration uses the current chance and reads a learned buff only after the strict roll succeeds',()=>{
  const child=buff('armor-break',4);
  for(const [chance,roll,success,draws] of [
    [-1,1,false,0],[0,1,false,0],[1,1,false,1],[260,259,true,1],[260,260,false,1],
    [999,999,false,1],[1000,999,true,1],
  ] as const){
    const reads:string[]=[];
    const input=ports(roll,(owner,skill)=>{reads.push(`${owner}/${skill}`);return child;});
    const commands=resolveSkillReactions([], {...physicalEffects,armorBreakChance:chance},input);
    assert.equal(input.draws(),draws);
    assert.deepEqual(reads,success?['attacker/armor-penetration']:[]);
    assert.deepEqual(commands,success?[{kind:'apply-buff',sourceId:'attacker',targetId:'defender',buff:child}]:[]);
  }
});

test('armor penetration resolves the learned rank after the roll instead of retaining an earlier rank',()=>{
  const earlier=buff('armor-break',1),current=buff('armor-break',8);
  let learned=earlier;
  const order:string[]=[];
  const input:SkillReactionPorts={
    random:()=>{order.push('roll');learned=current;return 0;},
    learnedBuff:(owner,skill)=>{order.push(`${owner}/${skill}`);return learned;},
  };
  assert.deepEqual(resolveSkillReactions([{kind:'armor-penetration',buff:earlier}],physicalEffects,input),[
    {kind:'apply-buff',sourceId:'attacker',targetId:'defender',buff:current},
  ]);
  assert.deepEqual(order,['roll','attacker/armor-penetration']);
});

test('an unlearned armor skill still consumes its positive chance roll before yielding no child',()=>{
  let lookups=0;
  const input=ports(1,()=>{lookups++;return undefined;});
  assert.deepEqual(resolveSkillReactions([],physicalEffects,input),[]);
  assert.equal(input.draws(),1);assert.equal(lookups,1);
});

test('all physical nonmiss outcomes reach armor penetration without requiring a positive damage amount',()=>{
  const child=buff('armor-break');
  for(const outcome of ['hit','critical','weapon-block','shield-block'] as const){
    const input=ports(1,()=>child);
    assert.deepEqual(resolveSkillReactions([], {...physicalEffects,outcome},input),[
      {kind:'apply-buff',sourceId:'attacker',targetId:'defender',buff:child},
    ]);
    assert.equal(input.draws(),1);
  }
  for(const event of [{...physicalEffects,outcome:'miss'},
    ...(['hit','critical','weapon-block','shield-block','miss'] as const)
      .map(outcome=>({...physicalEffects,damageKind:'magic' as const,outcome}))] as const){
    const input=ports(1,()=>assert.fail('excluded attack cannot look up the skill'));
    assert.deepEqual(resolveSkillReactions([],event,input),[]);assert.equal(input.draws(),0);
  }
});

test('armor penetration has its own phase and does not invoke unrelated learned reactions',()=>{
  const child=buff('armor-break'),armor:SkillReaction={kind:'armor-penetration',buff:child};
  const input=ports(1,()=>child);
  assert.deepEqual(resolveSkillReactions([soul(),blood,shield,flames(),wrath(),armor],physicalEffects,input),[
    {kind:'apply-buff',sourceId:'attacker',targetId:'defender',buff:child},
  ]);
  assert.equal(input.draws(),1);
  const unrelated:SkillReactionEvent[]=[hit,attackEffects,{kind:'physical-block',ownerId:'attacker'},
    {kind:'physical-hit-received',ownerId:'attacker'},{kind:'action-stealth-break',ownerId:'attacker'},
    {kind:'molten-reflection-completed',ownerId:'attacker',opponentId:'defender'}];
  for(const event of unrelated)assert.deepEqual(resolveSkillReactions([armor],event,input),[]);
  assert.equal(input.draws(),1);
});

test('blood thirst starts rolling at 200 and keeps strict 1–999 rolls even at 1000',()=>{
  for(const [chance,roll,success,draws] of [
    [-1,1,false,0],[0,1,false,0],[199,1,false,0],[200,199,true,1],[200,200,false,1],
    [999,999,false,1],[1000,999,true,1],
  ] as const){
    const input=ports(roll),commands:SkillReactionCommand[]=[],reads:string[]=[];
    executeBloodThirstReaction({...bloodThirst,chanceThreshold:chance},{random:input.random,
      lifeDrainPerThousand:()=>{reads.push('life-rate');return 221;},
      manaRecovery:()=>{reads.push('mana');return 0;},apply:command=>commands.push(command)});
    assert.equal(input.draws(),draws);
    assert.deepEqual(reads,success?['life-rate','mana']:[]);
    assert.deepEqual(commands,success?[
      {kind:'restore-health',targetId:'attacker',amount:22},
      {kind:'play-effect',targetId:'attacker',effect:'life-drain'},
    ]:[]);
  }
});

test('blood thirst reads its life rate after rolling and its mana after applying healing and the life effect',()=>{
  const order:string[]=[],commands:SkillReactionCommand[]=[];
  let rate=0,mana=0;
  executeBloodThirstReaction(bloodThirst,{
    random:()=>{order.push('roll');rate=221;return 0;},
    lifeDrainPerThousand:()=>{order.push('read-life-rate');return rate;},
    manaRecovery:()=>{order.push('read-mana');return mana;},
    apply:command=>{
      commands.push(command);
      order.push(command.kind==='play-effect'?command.effect:command.kind);
      if(command.kind==='restore-health')mana=7;
      if(command.kind==='play-effect'&&command.effect==='life-drain')mana=11;
    },
  });
  assert.deepEqual(order,['roll','read-life-rate','restore-health','life-drain','read-mana','restore-mana','mana-recovery']);
  assert.deepEqual(commands,[
    {kind:'restore-health',targetId:'attacker',amount:22},
    {kind:'play-effect',targetId:'attacker',effect:'life-drain'},
    {kind:'restore-mana',targetId:'attacker',amount:11},
    {kind:'play-effect',targetId:'attacker',effect:'mana-recovery'},
  ]);
});

test('blood thirst clamps a negative life rate and keeps zero healing followed by fixed mana recovery',()=>{
  for(const [damage,rate] of [[101,-10],[101,0],[1,221],[0,221]]){
    const commands:SkillReactionCommand[]=[];
    executeBloodThirstReaction({...bloodThirst,hitDamage:damage},{random:()=>0,
      lifeDrainPerThousand:()=>rate,manaRecovery:()=>7,apply:command=>commands.push(command)});
    assert.deepEqual(commands,[
      {kind:'restore-health',targetId:'attacker',amount:0},
      {kind:'play-effect',targetId:'attacker',effect:'life-drain'},
      {kind:'restore-mana',targetId:'attacker',amount:7},
      {kind:'play-effect',targetId:'attacker',effect:'mana-recovery'},
    ]);
  }
  for(const mana of [-7,0]){
    const commands:SkillReactionCommand[]=[];
    executeBloodThirstReaction(bloodThirst,{random:()=>0,lifeDrainPerThousand:()=>221,
      manaRecovery:()=>mana,apply:command=>commands.push(command)});
    assert.deepEqual(commands.map(command=>command.kind),['restore-health','play-effect']);
  }
});

test('blood thirst accepts four physical nonmiss outcomes at zero damage and excludes magic and misses',()=>{
  for(const outcome of ['hit','critical','weapon-block','shield-block'] as const){
    const commands:SkillReactionCommand[]=[];
    executeBloodThirstReaction({...bloodThirst,outcome,hitDamage:0},{random:()=>0,
      lifeDrainPerThousand:()=>221,manaRecovery:()=>0,apply:command=>commands.push(command)});
    assert.deepEqual(commands,[{kind:'restore-health',targetId:'attacker',amount:0},
      {kind:'play-effect',targetId:'attacker',effect:'life-drain'}]);
  }
  const forbidden=()=>assert.fail('an excluded outcome cannot read attributes, roll or apply commands');
  for(const event of [{...bloodThirst,outcome:'miss'},
    ...(['hit','critical','weapon-block','shield-block','miss'] as const)
      .map(outcome=>({...bloodThirst,damageKind:'magic' as const,outcome}))] as const)
    executeBloodThirstReaction(event,{random:forbidden,lifeDrainPerThousand:forbidden,manaRecovery:forbidden,apply:forbidden});
});

test('blood thirst effects preload from the active skill while execution uses only current attributes and source identity',()=>{
  const reaction:SkillReaction={kind:'blood-thirst',lifeEffect:'life-drain',manaEffect:'mana-recovery'};
  const definition:SkillDefinition={id:'blood-thirst',name:'Blood Thirst',kind:'active',icon:'',description:'',
    normalMaxLevel:4,ranks:[],action:null,reactionsByRank:Array.from({length:8},()=>[reaction])};
  assert.deepEqual(skillReactionEffects(definition),['life-drain','mana-recovery']);
  for(const ownerId of ['player','companion','monster']){
    const commands:SkillReactionCommand[]=[];
    executeBloodThirstReaction({...bloodThirst,ownerId},{random:()=>0,lifeDrainPerThousand:()=>221,
      manaRecovery:()=>7,apply:command=>commands.push(command)});
    assert.deepEqual(commands.flatMap(command=>'targetId' in command?[command.targetId]:[]),[ownerId,ownerId,ownerId,ownerId]);
  }
  const forbidden=()=>assert.fail('asset declarations do not trigger earlier attack-success reactions');
  assert.deepEqual(resolveSkillReactions([reaction],hit,{random:forbidden,learnedBuff:forbidden}),[]);
});

test('revenge uses one strict probability roll before reading the defender learned skill',()=>{
  const child=buff('revenge-incarnate');
  for(const [chance,roll,success,draws] of [
    [-1,1,false,0],[0,1,false,0],[1,1,false,1],[100,99,true,1],[100,100,false,1],
    [999,999,false,1],[1000,999,true,1],
  ] as const){
    const reads:string[]=[];
    const input=ports(roll,(owner,skill)=>{reads.push(`${owner}/${skill}`);return child;});
    const commands=resolveSkillReactions([],{...revenge,chanceThreshold:chance},input);
    assert.equal(input.draws(),draws);
    assert.deepEqual(reads,success?['defender/revenge-incarnate']:[]);
    assert.deepEqual(commands,success?[{kind:'apply-buff',sourceId:'defender',targetId:'defender',buff:child}]:[]);
  }
});

test('revenge resolves the current defender rank after the roll and ignores an earlier reaction snapshot',()=>{
  const earlier=buff('revenge-incarnate',1),current=buff('revenge-incarnate',8);
  for(const ownerId of ['player','companion']){
    let learned=earlier;
    const order:string[]=[];
    const input:SkillReactionPorts={
      random:()=>{order.push('roll');learned=current;return 0;},
      learnedBuff:(owner,skill)=>{order.push(`${owner}/${skill}`);return learned;},
    };
    assert.deepEqual(resolveSkillReactions([{kind:'revenge-incarnate',buff:earlier}],{...revenge,ownerId},input),[
      {kind:'apply-buff',sourceId:ownerId,targetId:ownerId,buff:current},
    ]);
    assert.deepEqual(order,['roll',`${ownerId}/revenge-incarnate`]);
  }
});

test('positive revenge chance still rolls when the defender has no learned skill',()=>{
  for(const ownerId of ['player','companion','monster']){
    const reads:string[]=[];
    const input=ports(1,(owner,skill)=>{reads.push(`${owner}/${skill}`);return undefined;});
    assert.deepEqual(resolveSkillReactions([],{...revenge,ownerId},input),[]);
    assert.equal(input.draws(),1);assert.deepEqual(reads,[`${ownerId}/revenge-incarnate`]);
  }
});

test('revenge accepts four physical nonmiss outcomes without a damage gate and excludes magic and misses',()=>{
  const child=buff('revenge-incarnate');
  for(const outcome of ['hit','critical','weapon-block','shield-block'] as const){
    const input=ports(1,()=>child);
    assert.deepEqual(resolveSkillReactions([],{...revenge,outcome},input),[
      {kind:'apply-buff',sourceId:'defender',targetId:'defender',buff:child},
    ]);
    assert.equal(input.draws(),1);
  }
  const forbidden=()=>assert.fail('an excluded outcome cannot roll or read the learned skill');
  for(const event of [{...revenge,outcome:'miss'},
    ...(['hit','critical','weapon-block','shield-block','miss'] as const)
      .map(outcome=>({...revenge,damageKind:'magic' as const,outcome}))] as const)
    assert.deepEqual(resolveSkillReactions([],event,{random:forbidden,learnedBuff:forbidden}),[]);
});

test('revenge has a separate phase from armor, blood thirst, reflection and wrath',()=>{
  const child=buff('revenge-incarnate'),reaction:SkillReaction={kind:'revenge-incarnate',buff:child};
  const input=ports(1,()=>child);
  assert.deepEqual(resolveSkillReactions([soul(),blood,shield,flames(),wrath(),reaction],revenge,input),[
    {kind:'apply-buff',sourceId:'defender',targetId:'defender',buff:child},
  ]);
  assert.equal(input.draws(),1);
  const forbidden=()=>assert.fail('an unrelated event cannot resolve revenge');
  const unrelated:SkillReactionEvent[]=[hit,attackEffects,bloodThirst,{kind:'physical-block',ownerId:'defender'},
    {kind:'physical-hit-received',ownerId:'defender'},{kind:'action-stealth-break',ownerId:'defender'},
    {kind:'molten-reflection-completed',ownerId:'defender',opponentId:'attacker'}];
  for(const event of unrelated)assert.deepEqual(resolveSkillReactions([reaction],event,{random:forbidden,learnedBuff:forbidden}),[]);
});

test('instinct preserves all eight rank thresholds and boosts an actual two-handed main weapon before rolling',()=>{
  const rates=[10,20,30,40,50,50,60,60],boosted=[15,30,45,60,75,75,90,90];
  for(const mainHandTwoHanded of [false,true])for(let rank=0;rank<rates.length;rank++){
    const threshold=(mainHandTwoHanded?boosted:rates)[rank];
    for(const roll of [threshold-1,threshold]){
      const input=ports(roll,()=>assert.fail('instinct does not look up a learned reaction'));
      assert.deepEqual(resolveSkillReactions([],{...instinct,chanceThreshold:rates[rank],mainHandTwoHanded},input),
        roll<threshold?[{kind:'reset-skill-cooldowns',targetId:'attacker'}]:[]);
      assert.equal(input.draws(),1);
    }
  }
});

test('instinct skips nonpositive chances, truncates the weapon multiplier and still rolls at guaranteed thresholds',()=>{
  for(const [chance,twoHanded,roll,success,draws] of [
    [-1,false,1,false,0],[-1,true,1,false,0],[0,false,1,false,0],[0,true,1,false,0],
    [1,false,1,false,1],[1,true,1,false,1],[11,true,15,true,1],[11,true,16,false,1],
    [666,true,999,false,1],[667,true,999,true,1],[1000,false,999,true,1],[1000,true,999,true,1],
  ] as const){
    const input=ports(roll,()=>assert.fail('current attribute values determine the trigger'));
    const commands=resolveSkillReactions([],{...instinct,chanceThreshold:chance,mainHandTwoHanded:twoHanded},input);
    assert.deepEqual(commands,success?[{kind:'reset-skill-cooldowns',targetId:'attacker'}]:[]);
    assert.equal(input.draws(),draws);
  }
});

test('instinct accepts every physical nonmiss outcome without a damage gate and excludes magic and misses',()=>{
  for(const outcome of ['hit','critical','weapon-block','shield-block'] as const){
    const input=ports(1,()=>assert.fail('instinct does not read learned ranks'));
    assert.deepEqual(resolveSkillReactions([],{...instinct,outcome},input),[
      {kind:'reset-skill-cooldowns',targetId:'attacker'},
    ]);
    assert.equal(input.draws(),1);
  }
  const forbidden=()=>assert.fail('an excluded outcome cannot roll or read learned skills');
  for(const event of [{...instinct,outcome:'miss'},
    ...(['hit','critical','weapon-block','shield-block','miss'] as const)
      .map(outcome=>({...instinct,damageKind:'magic' as const,outcome}))] as const)
    assert.deepEqual(resolveSkillReactions([],event,{random:forbidden,learnedBuff:forbidden}),[]);
});

test('instinct resets only the attacker and does not require or run another learned reaction',()=>{
  const unrelated:SkillReaction[]=[soul(),blood,shield,flames(),wrath(),
    {kind:'revenge-incarnate',buff:buff('revenge-incarnate')},
    {kind:'blood-thirst',lifeEffect:'life-drain',manaEffect:'mana-recovery'}];
  for(const ownerId of ['player','companion','monster'])for(const reactions of [[],unrelated]){
    const input=ports(1,()=>assert.fail('the current positive chance works without a learned reaction'));
    assert.deepEqual(resolveSkillReactions(reactions,{...instinct,ownerId},input),[
      {kind:'reset-skill-cooldowns',targetId:ownerId},
    ]);
    assert.equal(input.draws(),1);
  }
});
