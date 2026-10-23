import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Campaign } from '../src/domain/campaign.ts';
import type { WorldMap } from '../src/domain/content.ts';
import { StoryWorldState } from '../src/domain/story-world.ts';
import { generateMapEntities } from '../src/domain/scene-visit.ts';
import type { SpringCatalog } from '../src/domain/springs.ts';
import { resolveStoryScene } from '../src/domain/story-scene.ts';
import type { SceneSnapshot } from '../src/domain/scene-snapshot.ts';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/content/${name}.json`, import.meta.url), 'utf8')) as T;
const campaign = read<Campaign>('campaign');
const map = read<WorldMap>('maps/training-dungeon-one');

test('script bindings retain the complete projected scene including gates chests and springs', () => {
  const world = new StoryWorldState();
  world.apply({ kind: 'remove-character', map: map.id, characterId: 'npc-376', all: true });
  world.apply({ kind: 'place', scope: 'visit', entity: {
    id: 'quest-npc-located-npc-62', map: map.id, actor: 'berkel-soldier-48d3f50d', characterId: 'npc-62', x: 328, y: 440
  } });
  const visit=world.visit+1;
  const base=generateMapEntities(map,campaign,read<SpringCatalog>('springs'),1,()=>0);
  const roster=world.projectEntities(map.id,base,campaign.placements,visit).filter(entity=>world.visible(entity.id,visit));
  const actors = roster.map(member => ({ ...member, id: 'entity:' + member.id,worldEntityId:member.id,facing:'south' as const,visible:true }));
  const snapshot = resolveStoryScene({ type: 'stage', map: map.id, x: 200, y: 408, facing: 'south', playerVisible: true,
    cast: [{ id: 'laiman', actor: 'story-lehman-90989efd', characterId: 'npc-59', binding: 'world',
      x: 200, y: 408, facing: 'south', visible: true }] }, {
    map: map.id, actors: [{ id: 'player', actor: campaign.start.actor, x: 200, y: 408, facing: 'south', visible: true }, ...actors]
  });
  const ids = new Set(snapshot.scene.actors.filter(actor => actor.visible).map(actor => actor.worldEntityId));
  assert.ok(ids.has('quest-npc-located-npc-62'));
  assert.ok(ids.has('quest-npc-npc-351'));
  assert.ok(ids.has('leap-gate-253891b2-000'));
  assert.ok(ids.has('treasure-box-a0caef88-004'));
  assert.ok(ids.has('well-7abb1f76-010'));
  assert.ok(!ids.has('berkel-castle-knight-28dd5010-005'));
  for (const original of actors) assert.equal(snapshot.scene.actors.filter(actor => actor.id === original.id).length, 1);
});

test('Lehman events 47→48→49 retain each map portal through consecutive stages and travel',async()=>{
  const {applyStorySceneAction}=await import('../src/domain/story-scene.ts');
  const world=new StoryWorldState(),springs=read<SpringCatalog>('springs');
  const fresh=(id:string):SceneSnapshot=>{
    const map=read<WorldMap>('maps/'+id);
    const entities=world.projectEntities(id,generateMapEntities(map,campaign,springs,1,()=>0),campaign.placements,world.visit+1);
    return {map:id,actors:[{id:'player',actor:campaign.start.actor,x:360,y:408,facing:'south' as const,visible:true},
      ...entities.map(entity=>({id:'entity:'+entity.id,worldEntityId:entity.id,actor:entity.actor,characterId:entity.characterId,
        x:entity.x,y:entity.y,flip:entity.flip,facing:'south' as const,visible:world.visible(entity.id,world.visit+1)}))]};
  };
  let snapshot=resolveStoryScene({type:'stage',map:map.id,x:360,y:408,facing:'south',playerVisible:true,cast:[]},fresh(map.id));
  const checked=new Set<string>();
  for(const event of [47,48,49])for(const node of campaign.scripts['event-'+event].nodes)for(const action of node.presentation){
    if(action.type==='dialogue'||action.type==='choice'||action.type==='quest-popup')continue;
    if(action.type==='stage'){
      const target=action.mapFromWorld?snapshot.map:action.map;
      snapshot=resolveStoryScene(action,target===snapshot.map&&!action.resetActors?snapshot.scene:fresh(target));
    }else snapshot=applyStorySceneAction(snapshot,action);
    const portal=snapshot.scene.actors.filter(actor=>actor.characterId==='npc-111');
    assert.equal(portal.length,1,`event ${event}/${node.id} portal identity`);
    assert.equal(portal[0].visible,true,`event ${event}/${node.id} portal visibility`);
    checked.add(snapshot.map);
  }
  assert.deepEqual([...checked],['training-dungeon-one','old-sanctuary-54cffd62']);
  const portal=snapshot.scene.actors.find(actor=>actor.characterId==='npc-111')!;
  assert.deepEqual([portal.x,portal.y],[312,120]);
  assert.equal(portal.flip,fresh(snapshot.map).actors.find(actor=>actor.characterId==='npc-111')?.flip);
});
