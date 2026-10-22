import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {parseCampaign} from '../src/application/content-validation.ts';
import {resolveStoryStage,storyStageWorldCast,type StoryStage} from '../src/domain/story-performance.ts';
import {StoryWorldState} from '../src/domain/story-world.ts';
import type {WorldMap} from '../src/domain/content.ts';
import {Session} from '../src/domain/session.ts';
import {StoryDirector,type StoryUI} from '../src/domain/story-director.ts';

const hook=registerHooks({resolve(specifier,context,next){return specifier==='phaser'?{shortCircuit:true,url:`data:text/javascript,${encodeURIComponent('export default {Scene:class{},BlendModes:{NORMAL:0,MULTIPLY:1,SCREEN:2,ADD:3},Scenes:{Events:{SHUTDOWN:"shutdown"}},Cameras:{Scene2D:{Events:{PAN_COMPLETE:"pancomplete"}}}};')}`} :next(specifier,context);}});
const {StoryPresenter}=await import('../src/rendering/story-presenter.ts');hook.deregister();
const read=(name:string)=>JSON.parse(readFileSync(new URL('../public/content/'+name+'.json',import.meta.url),'utf8'));
const campaign=parseCampaign(read('campaign'));
const firstStage=(event:number)=>campaign.scripts['event-'+event].nodes.flatMap(node=>node.presentation).find(action=>action.type==='stage')!;
const register=(state:StoryWorldState,event:number)=>{
  for(const node of campaign.scripts['event-'+event].nodes)for(const command of node.commands)
    if(command.type==='world'&&command.command.kind==='place'&&command.command.entity.id.startsWith('quest-npc-located-'))state.apply(command.command);
};
const stage=(map:string,cast:StoryStage['cast']=[]):StoryStage=>({type:'stage',map,x:232,y:232,facing:'south',playerVisible:true,cast});
const arrival=(state:StoryWorldState,map:string)=>storyStageWorldCast(read('maps/'+map) as WorldMap,campaign.placements,state,()=>true);

test('287 registration supplies distinct NPC identities to event 290 without inventing positions',()=>{
  const state=new StoryWorldState();register(state,287);
  const declaration=firstStage(290),actors=arrival(state,declaration.map);
  const resolved=resolveStoryStage(declaration,stage('shadow-camp'),actors);
  for(const [id,x,y] of [['npc-57',88,472],['npc-396',136,472],['npc-66',120,568],['npc-67',168,568]] as const){
    const member=resolved.cast.find(member=>member.characterId===id)!;
    assert.deepEqual([member.x,member.y,member.visible,member.unpositioned],[x,y,true,undefined]);
    assert.equal(member.worldEntityId,'quest-npc-located-'+id);
  }
});

test('385→386 inherits the actual Ivan in this map; map loading uses its own projected NPC',()=>{
  const state=new StoryWorldState();register(state,385);
  const declaration=firstStage(386),ivan=declaration.cast.find(member=>member.characterId==='npc-451')!;
  assert.deepEqual([ivan.x,ivan.y,ivan.visible,ivan.unpositioned],[2048,2048,false,true]);
  const current=stage(declaration.map,[{...ivan,x:224,y:192,facing:'east',visible:true,unpositioned:undefined}]);
  const live=resolveStoryStage(declaration,current).cast.find(member=>member.characterId==='npc-451')!;
  assert.deepEqual([live.x,live.y,live.facing,live.visible,live.unpositioned],[224,192,'east',true,undefined]);
  const reloaded=resolveStoryStage({...declaration,resetActors:true},current,arrival(state,declaration.map));
  assert.deepEqual(reloaded.cast.filter(member=>member.characterId==='npc-451').map(member=>[member.x,member.y]),[[216,184]]);
});

test('a missing NPC stays offstage after a map change and its checkpoint flag survives JSON content parsing',()=>{
  const declaration=firstStage(386),ivan=declaration.cast.find(member=>member.characterId==='npc-451')!;
  const old=stage('shadow-camp',[{...ivan,x:24,y:40,visible:true,unpositioned:undefined}]);
  const resolved=resolveStoryStage({...declaration,resetActors:true},old,[]);
  const member=resolved.cast.find(member=>member.characterId==='npc-451')!;
  assert.deepEqual([member.x,member.y,member.visible,member.unpositioned],[2048,2048,false,true]);
  const restored=parseCampaign(JSON.parse(JSON.stringify({...campaign,scripts:{...campaign.scripts,
    'implicit-checkpoint':{entry:'end',nodes:[{id:'end',presentation:[resolved],commands:[],exit:{type:'end'}}]}}})));
  const saved=restored.scripts['implicit-checkpoint'].nodes[0].presentation[0];
  assert.equal(saved.type,'stage');if(saved.type==='stage')assert.equal(saved.cast.find(member=>member.characterId==='npc-451')?.unpositioned,true);
});

test('the presenter never moves an unpositioned actor into the map, including skipped parallel playback',async()=>{
  const placements:unknown[]=[];
  const visual={container:{x:2048,y:2048,visible:false}};
  const performer={visual,unpositioned:true,facing:'south'};
  const movement={placeAll(values:unknown[]){placements.push(...values);},place(){throw new Error('offstage walk must not place');},
    walkTo(){throw new Error('offstage walk must not navigate');}};
  const presenter=new StoryPresenter({} as never,()=>({} as never),()=>({movement} as never));
  Object.assign(presenter,{actors:new Map([['ivan',performer]])});
  const signal=new AbortController().signal,skip=new AbortController();skip.abort();
  const action={type:'walk' as const,target:'ivan',x:216,y:184,speedPxPerSecond:100};
  await presenter.execute(action,{signal,skipSignal:signal});
  await presenter.parallel([action],{signal,skipSignal:skip.signal});
  assert.deepEqual(placements,[]);assert.deepEqual([visual.container.x,visual.container.y],[2048,2048]);
});

test('explicit healer placement binds NPC 478 independently of inheriting its position',()=>{
  const declaration=campaign.scripts['event-384'].nodes.flatMap(node=>node.presentation)
    .find(action=>action.type==='stage'&&action.cast.some(member=>member.characterId==='npc-478'))!;
  assert.equal(declaration.type,'stage');if(declaration.type!=='stage')return;
  const healer=declaration.cast.find(member=>member.characterId==='npc-478')!;
  assert.notEqual(healer.inheritPosition,true);
  const existing={...healer,id:'quest-npc-located-npc-478',worldEntityId:'quest-npc-located-npc-478',x:120,y:136};
  const resolved=resolveStoryStage(declaration,stage('shadow-camp'),[existing]);
  const bound=resolved.cast.find(member=>member.characterId==='npc-478')!;
  assert.equal(bound.worldEntityId,existing.id);
  assert.deepEqual([bound.x,bound.y],[healer.x,healer.y]);
});

test('world-bound ordinary NPC movement expires on leaving; native location registrations keep their lifetime',async()=>{
  const content={...campaign,quests:[],questGroups:[],placements:[],enemyPlacements:[],exitRules:[],events:[],
    scripts:{binding:{entry:'done',nodes:[{id:'done',presentation:[{type:'wait' as const,durationMs:0}],commands:[],exit:{type:'end' as const}}]}}};
  const session=new Session(content);
  const map='berkel-capital',ordinary={id:'ordinary',map,actor:'guard',characterId:'npc-63',x:80,y:80,visible:true};
  session.applyStoryCommands([{type:'travel',destination:{map,x:24,y:24,facing:'south'}},
    {type:'world',command:{kind:'place',entity:{...ordinary,id:'quest-npc-located-npc-63',x:120}}}]);
  const moved=[{...ordinary,x:160},{...ordinary,id:'quest-npc-located-npc-63',x:200}];
  const ui:StoryUI={async dialogue(){},async choice(_prompt,options){return options[0];},async questPopup(){},toast(){},closeDialogue(){},skipDialogue(){}};
  const director=new StoryDirector(content,session,ui,()=>{}, {begin(){},async execute(){},async finish(){},getWorldChanges:()=>moved});
  try{
    await director.script('binding');
    assert.equal(session.storyWorld.entity('ordinary')?.mapVisit,session.storyWorld.visit);
    assert.equal(session.storyWorld.entity('quest-npc-located-npc-63')?.mapVisit,undefined);
    session.applyStoryCommands([{type:'travel',destination:{map:'shadow-camp',x:24,y:24,facing:'south'}},
      {type:'travel',destination:{map,x:24,y:24,facing:'south'}}]);
    assert.equal(session.storyWorld.entity('ordinary'),undefined);
    assert.equal(session.storyWorld.entity('quest-npc-located-npc-63')?.x,200);
  }finally{director.dispose();}
});

test('event 98 location registration is not overwritten by the old cinematic actor in later nodes',async()=>{
  const content={...campaign,events:[],scripts:{'event-98':campaign.scripts['event-98']}};
  const session=new Session(content),id='quest-npc-located-npc-288';
  const entity={id,map:'hwagan-canyon-2-c2fa2ee1',actor:'story-stranger-of-hwagan-b390b261',characterId:'npc-288',x:664,y:152,visible:true};
  session.applyStoryCommands([{type:'travel',destination:{map:entity.map,x:664,y:200,facing:'north'}},
    {type:'world',command:{kind:'place',entity}}]);
  const ui:StoryUI={async dialogue(){},async choice(_prompt,options){return options[0];},async questPopup(){},toast(){},closeDialogue(){},skipDialogue(){}};
  const director=new StoryDirector(content,session,ui,()=>{}, {begin(){},async execute(){},async finish(){},getWorldChanges:()=>[{...entity,visible:false}]});
  try{
    await director.script('event-98');
    const registered=session.storyWorld.entity(id)!;
    assert.deepEqual([registered.map,registered.x,registered.y,registered.visible,registered.removed],['stranger-s-house-b201c183',216,136,true,false]);
    assert.equal(session.status('quest-117'),'active');
  }finally{director.dispose();}
});

test('arrival projection reads the next visit without mutating the formal map and a reload excludes old visit actors',()=>{
  const state=new StoryWorldState(),map=read('maps/sealed-dungeon-3-3-11ff2101') as WorldMap;
  state.apply({kind:'travel',destination:{map:'shadow-camp',x:24,y:24,facing:'south'}});
  state.apply({kind:'place',scope:'visit',entity:{id:'arrival-ivan',map:map.id,actor:'ivan-451',characterId:'npc-451',x:216,y:184}});
  const before=state.captureState();
  assert.ok(storyStageWorldCast(map,campaign.placements,state,()=>true).some(member=>member.id==='arrival-ivan'));
  assert.deepEqual(state.captureState(),before);
  state.apply({kind:'travel',destination:{map:map.id,x:24,y:24,facing:'south'}});
  assert.ok(storyStageWorldCast(map,campaign.placements,state,()=>true).some(member=>member.id==='arrival-ivan'));
  assert.ok(!storyStageWorldCast(map,campaign.placements,state,()=>true,true).some(member=>member.id==='arrival-ivan'));
});

test('reloading restores the original map NPC underneath expired visit overrides and locations',()=>{
  const state=new StoryWorldState(),map=read('maps/berkel-capital') as WorldMap;
  const base=map.entities.find(entity=>entity.characterId==='npc-611')!;
  state.apply({kind:'travel',destination:{map:map.id,x:232,y:312,facing:'south'}});
  state.apply({kind:'place',scope:'visit',entity:{...base,map:map.id,x:520,y:184,visible:false}});
  state.apply({kind:'place',scope:'visit',entity:{...base,id:'quest-npc-located-transient-door',map:map.id,x:504,y:184}});
  const hidden=map.entities.find(entity=>entity.id!==base.id)!;
  state.apply({kind:'hide',id:hidden.id});
  const reset=storyStageWorldCast(map,campaign.placements,state,()=>true,true);
  assert.ok(!reset.some(member=>member.id===hidden.id),'persistent hide still applies');
  assert.deepEqual(reset.filter(member=>member.characterId==='npc-611').map(member=>[member.id,member.x,member.y]),[[base.id,base.x,base.y]]);
});

test('event 4 inherits the saint from the arrival map when the current stage cast lacks her',()=>{
  const state=new StoryWorldState();
  state.apply({kind:'travel',destination:{map:'silent-cave-depths',x:200,y:232,facing:'south'}});
  const apply=(event:number)=>{for(const node of campaign.scripts['event-'+event].nodes)for(const command of node.commands)if(command.type==='world')state.apply(command.command);};
  apply(2);apply(3);
  const declaration=firstStage(4);
  // 同一张图的舞台没有带上她（重播、上一幕收起）时，必须回到到达地图的世界投影找人，
  // 不能因为 current.cast 缺人就把圣女判成不在场。
  const resolved=resolveStoryStage(declaration,stage('silent-cave-depths',[]),arrival(state,'silent-cave-depths'));
  const saint=resolved.cast.find(member=>member.characterId==='npc-79')!;
  assert.deepEqual([saint.x,saint.y,saint.visible,saint.unpositioned],[360,136,true,undefined]);
  assert.equal(saint.worldEntityId,'quest-npc-located-npc-79');
});

test('开场士兵写回他走到营地的位置，而不是出口旁的放置点',()=>{
  const state=new StoryWorldState();
  for(const node of campaign.scripts['event-0'].nodes)for(const command of node.commands)if(command.type==='world')state.apply(command.command);
  const soldier=state.entity('story-character-npc-41');
  assert.deepEqual([soldier?.map,soldier?.x,soldier?.y,soldier?.visible],['shadow-camp',184,312,true]);
});

// 原版 `0x00` 是本次场景生成角色（`CHARSYSTEM_Produce`），`0x22` 才是跨切图的常驻登记
// （`CHARLOCSYSTEM_Add`）。事件 2 的圣女只是场景角色；事件 3 在洞口把她登记到 (360,136)，
// 事件 4 靠这条登记把她接回台上。事件 5 的圣女、鑫迪和三具倒下的士兵都只是场景角色，
// 离开洞穴后不能留在世界状态里——否则出洞再进洞会看到一排不能互动的“幽灵”。
test('剧情临时角色只活到本次访问，登记过的圣女跨访问保留而临时角色被清掉',()=>{
  const state=new StoryWorldState(),map=read('maps/silent-cave-depths') as WorldMap;
  const apply=(event:number)=>{for(const node of campaign.scripts['event-'+event].nodes)for(const command of node.commands)if(command.type==='world')state.apply(command.command);};
  const actors=()=>storyStageWorldCast(map,campaign.placements,state,()=>true);
  state.apply({kind:'travel',destination:{map:'silent-cave-depths',x:200,y:232,facing:'south'}});

  apply(2);
  assert.ok(!actors().some(member=>member.characterId==='npc-79'),'事件 2 的圣女只是场景角色，不写回世界');
  assert.ok(actors().some(member=>member.characterId==='npc-84'),'同一张图的后续事件仍能继承临时角色');

  apply(3);
  const registered=actors().find(member=>member.characterId==='npc-79')!;
  assert.ok(registered,'事件 3 的 0x22 登记把圣女留在地图上');
  assert.deepEqual([registered.x,registered.y,registered.visible],[360,136,true]);

  // 离开再回来：临时角色随旧访问清掉，0x22 登记的圣女留下。
  state.apply({kind:'travel',destination:{map:'silent-cave-entrance',x:616,y:72,facing:'south'}});
  state.apply({kind:'travel',destination:{map:'silent-cave-depths',x:200,y:232,facing:'south'}});
  const afterVisits=actors();
  assert.ok(!afterVisits.some(member=>['npc-56','npc-83','npc-84','npc-85'].includes(member.characterId!)),'临时角色不跨访问');
  assert.ok(afterVisits.some(member=>member.characterId==='npc-79'),'登记角色跨访问保留');

  // 事件 4 演完注销登记；事件 5 再次入洞时，圣女与倒下的士兵都只留在舞台上。
  apply(4);apply(5);
  state.apply({kind:'travel',destination:{map:'silent-cave-entrance',x:616,y:72,facing:'south'}});
  state.apply({kind:'travel',destination:{map:'silent-cave-depths',x:200,y:232,facing:'south'}});
  const ghosts=actors().filter(member=>['npc-56','npc-79','npc-83','npc-84','npc-85'].includes(member.characterId!));
  assert.deepEqual(ghosts,[],'出洞再进洞不应留下任何剧情角色');

  const declaration=firstStage(4);
  assert.equal(declaration.retainPlayerPosition,true,'原版这一段从没摆过主角，他接着自己走进来的位置');
});
