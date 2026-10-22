import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {playthrough} from './helpers/story-playthrough.ts';
import type {Campaign} from '../src/domain/campaign.ts';
import {Session} from '../src/domain/session.ts';
import {StoryDirector,type StoryUI} from '../src/domain/story-director.ts';

// Isolated lawful admission; actual entry, choices, registrations and exits are unchanged.
const enter=async(option:string)=>{
  const h=playthrough();
  h.session.applyStoryCommands([{type:'travel',destination:{map:'berkel-capital',x:232,y:312,facing:'north'}}]);
  h.session.accept('quest-472');h.choices([option]);await h.approach('npc-611');return h;
};

test('560 cancellation executes native 478 registration and the guide reopens the choice',async()=>{
  const h=await enter('option-3');let restored:ReturnType<typeof playthrough>|undefined;
  try{
    assert.ok(h.session.runtimeState.completedEvents.includes('event-478'),'the original cancellation callback runs on the first choice');
    assert.equal(h.session.status('quest-403'),'active');
    const guide=h.entities().filter(entity=>entity.characterId==='npc-598');
    assert.equal(guide.length,1);assert.deepEqual([guide[0].x,guide[0].y],[232,200]);
    assert.equal(h.session.storyWorld.entity(guide[0].id)?.mapVisit,undefined,'native 0x21/22 is a persistent registration');
    restored=playthrough(JSON.parse(JSON.stringify(h.session.captureState())));
    assert.equal(restored.entities().filter(entity=>entity.characterId==='npc-598').length,1);
    restored.choices(['option-0']);await restored.approach('npc-598');
    assert.ok(restored.session.runtimeState.completedEvents.includes('event-479'));
    assert.ok(restored.session.runtimeState.completedEvents.includes('event-446'));
    assert.equal(restored.session.status('quest-374'),'active');
    await restored.travel('dark-woods-1-bc45ec02');
    await restored.travel('kiyan-s-memory-layer-1-631d46d8');
    assert.equal(restored.entities().filter(entity=>entity.characterId==='npc-598').length,1,'the native registered guide returns through real exported exits');
  }finally{h.director.dispose();restored?.director.dispose();}
});

test('queued near, region and interaction occurrences still expire after a new visit to the same map',async()=>{
  const base:Campaign=JSON.parse(readFileSync(new URL('../public/content/campaign.json',import.meta.url),'utf8'));
  const sources=['near','region','interaction'] as const;
  const campaign:Campaign={...base,events:sources.map(source=>({id:source,source,script:source})),scripts:{
    block:{entry:'block',nodes:[{id:'block',presentation:[{type:'wait',durationMs:1}],commands:[],exit:{type:'end'}}]},
    ...Object.fromEntries(sources.map(source=>[source,{entry:source,nodes:[{id:source,presentation:[],commands:[{type:'flag',flag:source}],exit:{type:'end'}}]}]))}};
  const session=new Session(campaign),map='shadow-camp';
  session.applyStoryCommands([{type:'travel',destination:{map,x:24,y:24,facing:'south'}}]);
  let entered!:()=>void,release!:()=>void;
  const enteredWait=new Promise<void>(resolve=>entered=resolve),blocked=new Promise<void>(resolve=>release=resolve);
  const ui:StoryUI={async dialogue(){},async choice(_prompt,options){return options[0];},async questPopup(){},toast(){},closeDialogue(){},skipDialogue(){}};
  const director=new StoryDirector(campaign,session,ui,()=>{}, {begin(){},async execute(){entered();await blocked;},async finish(){}});
  try{
    const playing=director.script('block');await enteredWait;
    const queued=sources.map(source=>director.notify(source,undefined,map));
    session.applyStoryCommands([{type:'travel',destination:{map:'berkel-capital',x:232,y:312,facing:'south'}},
      {type:'travel',destination:{map,x:24,y:24,facing:'south'}}]);
    release();await playing;
    assert.deepEqual(await Promise.all(queued),[false,false,false]);
    for(const source of sources)assert.equal(session.flags.has(source),false);
    assert.equal(await director.notify('near',undefined,map),true,'current visit can still dispatch');
  }finally{release();director.dispose();}
});

test('560 first branch selection executes 446 immediately without needing a second interaction',async()=>{
  const h=await enter('option-0');
  try{
    assert.ok(h.session.runtimeState.completedEvents.includes('event-446'));
    assert.equal(h.session.status('quest-374'),'active');
    assert.equal(h.entities().filter(entity=>entity.characterId==='npc-598').length,1);
  }finally{h.director.dispose();}
});

test('a cleared memory road reopens one menu and resets only its own marker',async()=>{
  const h=await enter('option-0');
  try{
    // 462 在道路 Boss 倒下时完成标记 399；这里用同一条原版状态写入，不重跑整条道路。
    h.session.applyStoryCommands([{type:'quest',command:{type:'script-complete',quest:'quest-399'}}]);
    assert.equal(h.session.status('quest-399'),'completed');
    h.choices(['option-1']);await h.approach('npc-598');
    assert.ok(h.session.runtimeState.completedEvents.includes('event-453'));
    assert.equal(h.session.status('quest-399'),'active','返场菜单把标记写回进行中，下一次近身才不会再命中同一条返场');
    assert.equal(h.session.status('quest-400'),'active','单次选择就接到第二条道路');
    h.session.applyStoryCommands([{type:'quest',command:{type:'script-complete',quest:'quest-400'}}]);
    h.choices(['option-2']);await h.approach('npc-598');
    assert.ok(h.session.runtimeState.completedEvents.includes('event-454'));
    assert.equal(h.session.status('quest-401'),'active','第三条道路由第二条道路的返场菜单接上');
    assert.equal(h.session.runtimeState.completedEvents.includes('event-478'),false,'一次近身只上演一段返场，没有多余菜单走取消分支');
  }finally{h.director.dispose();}
});
