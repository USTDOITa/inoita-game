import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleCatalog} from '../src/domain/battle.ts';
import {disturbanceCandidate,type DisturbanceActor} from '../src/domain/disturbance.ts';
import {rectDistance} from '../src/domain/rect-distance.ts';
import {registerHooks} from 'node:module';
const phaser=registerHooks({resolve(specifier,context,next){return specifier==='phaser'
  ?{url:'data:text/javascript,export default {BlendModes:{},Scene:class{},Physics:{Arcade:{Body:class{}}}}',shortCircuit:true}:next(specifier,context);}});
const {WorldCombat}=await import('../src/scenes/world-combat.ts');phaser.deregister();
const method=(name:string)=>Reflect.get(WorldCombat.prototype,name);

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const thresholds=[140,200,260,320,350,380,410,440];

test('eight ranks carry the defending side threshold and no passive modifier',()=>{
  const skill=catalog.skills['disturbance'];
  assert.deepEqual(skill.passiveUnits,[]);
  skill.reactionsByRank!.forEach((rank,index)=>
    assert.deepEqual(rank,[{kind:'disturbance',chanceThreshold:thresholds[index]}],`rank ${index+1}`));
});

const rect=(width=16,height=16)=>({x:-width/2,y:-height/2,width,height});
const actor=(id:string,x:number,defense:number,extra:Partial<DisturbanceActor>={}):DisturbanceActor=>
  ({id,sameCamp:true,ownSummon:false,position:{x,y:0},bounds:rect(),effectiveDefense:defense,...extra});
const self=actor('self',0,200);

test('the rectangular distance is the two axes floor-divided by eight and then added',()=>{
  // 两个 16 宽的对象：间隙 62 像素是 7 格，加 2 仍在 64 格以内。
  assert.equal(rectDistance(self,actor('far',78,900)),7);
  assert.equal(disturbanceCandidate(self,[actor('far',78,900)]),'far');
  // 间隙 503 像素是 62 格，加 2 正好 64；504 像素是 63 格，加 2 越界。
  const edge:DisturbanceActor={...actor('edge',519,900),position:{x:519,y:0}};
  assert.equal(rectDistance(self,edge),62);
  assert.equal(disturbanceCandidate(self,[edge]),'edge');
  const over:DisturbanceActor={...actor('over',520,900),position:{x:520,y:0}};
  assert.equal(rectDistance(self,over),63);
  assert.equal(disturbanceCandidate(self,[over]),undefined);
  // 纵向同样按格算。
  const above:DisturbanceActor={...actor('above',0,900),position:{x:0,y:519}};
  assert.equal(rectDistance(self,above),62);
  const corner:DisturbanceActor={...actor('corner',8,900),position:{x:8,y:8}};
  assert.equal(rectDistance(self,corner),0,'两个轴都重叠就是 0');
});

test('the highest effective defense wins regardless of distance, and ties keep the first',()=>{
  const near=actor('near',40,250),far=actor('far',70,400);
  assert.equal(disturbanceCandidate(self,[near,far]),'far','更远但更扛打的赢');
  const first=actor('first',30,400),second=actor('second',40,400);
  assert.equal(disturbanceCandidate(self,[first,second]),'first','相等保留先遇到的');
  assert.equal(disturbanceCandidate(self,[actor('weaker',30,150)]),undefined,'不比自己高就不算');
  assert.equal(disturbanceCandidate(self,[actor('equal',30,200)]),undefined,'相等不算严格更高');
  assert.equal(disturbanceCandidate(self,[]),undefined,'没有候选就不改变');
});

test('the defender own summon wins immediately, anyone else summon does not',()=>{
  const own=actor('own-summon',40,100,{ownSummon:true});
  const stronger=actor('stronger',50,900);
  assert.equal(disturbanceCandidate(self,[stronger,own]),'own-summon','自己拥有的召唤物立刻选中');
  const foreign=actor('foreign-summon',40,100);
  assert.equal(disturbanceCandidate(self,[foreign,stronger]),'stronger','别人的召唤物没有优先');
  // 自己与敌对阵营都不进候选。
  assert.equal(disturbanceCandidate(self,[actor('self',10,900)]),undefined);
  assert.equal(disturbanceCandidate(self,[actor('enemy',10,900,{sameCamp:false})]),undefined);
});

/** 场景侧读取：候选与守卫都用当前防御×防御率，不再只看面板基础防御。 */
test('世界侧按当前防御与防御率选候选，装备与增益都算进去',()=>{
  const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
  const thresholds=catalog.skills['disturbance'].reactionsByRank!.map(rank=>{
    const reaction=rank[0]!;
    return reaction.kind==='disturbance'?reaction.chanceThreshold:0;
  });
  const draft=()=>({levels:{disturbance:8}});
  const defenses:{[id:string]:{defense:number;rate:number}}={guard:{defense:100,rate:0},plate:{defense:60,rate:900},ally:{defense:100,rate:0}};
  const member={classId:'ranger',panel:{baseDefense:100},skills:{draft}};
  const actor=(id:string,x:number,team='party')=>({id,team,position:{x,y:0},bounds:{x:-4,y:-4,width:8,height:8}});
  const roster=[actor('guard',0),actor('plate',40),actor('ally',48),actor('enemy',200,'hostile')];
  const taunts:{candidate:string;attacker:string}[]=[];
  const host=Object.setPrototypeOf({
    app:{battleCatalog:catalog,session:{skills:{draft}}},
    memberOf:(id:string)=>id==='enemy'?undefined:member,
    combatant:(id:string)=>roster.find(entry=>entry.id===id),
    combatants:()=>roster,
    arena:[],
    actorAttribute:(id:string,key:string)=>key==='defense'?(defenses[id]?.defense??0):key==='defenseRate'?(defenses[id]?.rate??0):0,
    threat:{taunt:(candidate:string,attacker:string)=>taunts.push({candidate,attacker})},
    currentTargetOf:()=>undefined,
  },WorldCombat.prototype);
  const original=Math.random;Math.random=()=>0.5/999;
  try{
    method('disturbanceReaction').call(host,'enemy','guard');
  }finally{Math.random=original;}
  assert.equal(thresholds.length,8);
  assert.deepEqual(taunts,[{candidate:'plate',attacker:'enemy'}],'护甲 60×1.9 高于守卫的 100，护甲被选中');
});
