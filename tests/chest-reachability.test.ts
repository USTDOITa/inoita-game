import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Campaign } from '../src/domain/campaign.ts';
import type { WorldIndex, WorldMap } from '../src/domain/content.ts';
import { nearInteractable, canReachChest } from '../src/domain/chests.ts';
import { NavigationWorld, mirroredCollision } from '../src/domain/navigation-world.ts';
import type { Point } from '../src/domain/navigation.ts';
import { findPath } from '../src/domain/pathfinding.ts';

const read=<T>(file:string):T=>JSON.parse(readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8')) as T;
const world=read<WorldIndex>('content/world.json'),campaign=read<Campaign>('content/campaign.json');
const maps=world.maps.map(reference=>read<WorldMap>(reference.file));
const hero=world.actors[campaign.start.actor];

function navigationFor(map:WorldMap):NavigationWorld {
  const navigation=new NavigationWorld(map);
  // 所有原始实体同时占位，比随机摆放后更保守；沿用游戏的脚底范围与地形检查。
  for(const entity of map.entities)navigation.register({
    shape:()=>({collision:mirroredCollision(world.actors[entity.actor].collision,entity.flip)}),
    position:()=>entity,enabled:()=>true
  });
  return navigation;
}

test('all 87 treasure placements have a standable position for both manual opening inputs',()=>{
  let checked=0;
  for(const map of maps) {
    const chests=map.entities.filter(entity=>world.actors[entity.actor].chest);
    if(!chests.length)continue;
    const navigation=navigationFor(map);
    for(const chest of chests) {
      const positions:Point[]=[];
      for(let y=chest.y-24;y<=chest.y+24;y+=4)for(let x=chest.x-24;x<=chest.x+24;x+=4) {
        const point={x,y};
        if(nearInteractable(point,chest)&&canReachChest(point,chest)&&navigation.canPlace(hero,point))positions.push(point);
      }
      assert(positions.length>0,`${map.name}/${chest.id} 缺少可站立的开箱位置`);
      checked++;
    }
  }
  assert.equal(checked,87);
});

test('85 treasure placements can be approached from map entrances; two entrance-free maps retain local access coverage',()=>{
  const entrances=new Map<string,Point[]>();
  const add=(id:string,point:Point)=>{
    const points=entrances.get(id)??[];
    if(!points.some(existing=>existing.x===point.x&&existing.y===point.y))points.push(point);
    entrances.set(id,points);
  };
  add(campaign.start.map,campaign.start);
  for(const map of maps)for(const exit of map.exits)add(exit.destination,exit.spawn);

  let checked=0;
  const withoutEntrance:string[]=[];
  for(const map of maps) {
    const chests=map.entities.filter(entity=>world.actors[entity.actor].chest);
    if(!chests.length)continue;
    const navigation=navigationFor(map);
    // 入口被实体占住时，与实际落位一样寻找最近的合法位置。
    const starts=(entrances.get(map.id)??[]).map(point=>navigation.nearest(hero,point));
    for(const chest of chests) {
      if(!starts.length) {withoutEntrance.push(`${map.id}/${chest.id}`);continue;}
      const reachable=starts.some(start=>findPath(start,{
        bounds:navigation.bounds,canStand:point=>navigation.canPlace(hero,point),
        isGoal:point=>nearInteractable(point,chest)&&canReachChest(point,chest)&&navigation.canPlace(hero,point),
        heuristic:point=>Math.max(0,Math.hypot(point.x-chest.x,point.y-chest.y)-24)
      })!==null);
      assert(reachable,`${map.name}/${chest.id} 从现有入口无法走近开箱`);
      checked++;
    }
  }
  assert.equal(checked,85);
  assert.deepEqual(withoutEntrance.sort(),[
    'goblin-s-kitchen-f55c20ca/treasure-box-a0caef88-006',
    'goblin-s-storage-b89e5292/treasure-box-a0caef88-001'
  ]);
});
