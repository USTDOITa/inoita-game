import assert from 'node:assert/strict';
import test from 'node:test';
import {canTraverse,createPathSearch,findPath,type PathQuery,type PathSearchResult} from '../src/domain/pathfinding.ts';
import {NavigationWorld,type NavigationActor} from '../src/domain/navigation-world.ts';
import type {Point} from '../src/domain/navigation.ts';

const bounds={x:0,y:0,width:64,height:64};
function query(goal:Point,blocked:(point:Point)=>boolean=()=>false):PathQuery {
  return {bounds:{...bounds},canStand:point=>point.x>=0&&point.y>=0&&point.x<=64&&point.y<=64&&!blocked(point),
    isGoal:point=>point.x===goal.x&&point.y===goal.y,heuristic:point=>Math.hypot(point.x-goal.x,point.y-goal.y)};
}
function finish(search:ReturnType<typeof createPathSearch>,budget:number):PathSearchResult {
  for(let frame=0;frame<10000;frame++){
    const result=search.step(budget);
    assert.ok(result.expanded<=budget,'每次调用都必须遵守节点预算');
    if(result.status!=='pending')return result;
  }
  assert.fail('搜索未能结束');
}

test('slicing retains existing A* route order for open ground, walls, corners and non-grid starts',()=>{
  // 路径来自改造前的同步入口，固定次序也能发现等长路线的枚举变化。
  const fixtures=[
    {start:{x:8,y:8},goal:{x:40,y:40},blocked:()=>false,path:[[16,16],[24,24],[32,32],[40,40]]},
    {start:{x:8,y:8},goal:{x:40,y:8},blocked:(p:Point)=>p.x===24&&p.y<40,
      path:[[16,16],[16,24],[16,32],[16,40],[24,40],[32,40],[32,32],[40,24],[40,16],[40,8]]},
    {start:{x:11,y:13},goal:{x:40,y:40},blocked:()=>false,path:[[16,16],[24,24],[32,32],[40,40]]},
    {start:{x:8,y:8},goal:{x:16,y:16},blocked:(p:Point)=>(p.x>=12&&p.x<=20&&p.y>=4&&p.y<=12)||
      (p.x>=4&&p.x<=12&&p.y>=12&&p.y<=20),path:[[0,8],[0,16],[0,24],[8,24],[16,24],[16,16]]},
    {start:{x:8,y:8},goal:{x:40,y:8},blocked:(p:Point)=>p.x>=22&&p.x<=26,path:null},
  ];
  for(const fixture of fixtures){
    const expected=fixture.path?.map(([x,y])=>({x,y}))??null;
    assert.deepEqual(findPath(fixture.start,query(fixture.goal,fixture.blocked)),expected);
    for(const budget of [1,2,7,64]){
      const result=finish(createPathSearch(fixture.start,query(fixture.goal,fixture.blocked)),budget);
      assert.deepEqual(result.status==='found'?result.path:null,expected);
    }
  }
});

test('a spent budget stays pending until the search can prove found or unreachable',()=>{
  const search=createPathSearch({x:8,y:8},query({x:40,y:8},p=>p.x>=22&&p.x<=26));
  assert.deepEqual(search.step(0),{status:'pending',expanded:0});
  assert.deepEqual(search.step(1),{status:'pending',expanded:1});
  const completed=finish(search,1);
  assert.equal(completed.status,'unreachable');
  assert.deepEqual(search.step(64),{status:'unreachable',expanded:0});
  for(const invalid of [-1,NaN,1.5,-Infinity])assert.throws(()=>search.step(invalid),RangeError);
});

test('completed tasks expose independent route points and do not repeat queries',()=>{
  let calls=0;
  const goal={x:40,y:40},original=query(goal);
  const search=createPathSearch({x:8,y:8},{...original,isGoal:point=>{calls++;return original.isGoal(point);}});
  const result=finish(search,2);
  assert.equal(result.status,'found');
  if(result.status!=='found')return;
  const expected=structuredClone(result.path),finishedCalls=calls;
  result.path[0].x=-100;
  const repeated=search.step(0);
  assert.deepEqual(repeated,{status:'found',path:expected,expanded:0});
  assert.equal(calls,finishedCalls);
  const alreadyThere=createPathSearch(goal,query(goal)).step(1);
  assert.deepEqual(alreadyThere,{status:'found',path:[],expanded:1});
});

test('navigation snapshots freeze own shape, all dynamic occupancies, enabled state, terrain and bounds',()=>{
  const map={name:'snapshot',tileSize:8,columns:16,rows:16,blocked:Array<boolean>(256).fill(false)};
  const world=new NavigationWorld(map);
  const ownPosition={x:16,y:16},ownCollision={x:-4,y:-4,width:8,height:8};
  const obstaclePosition={x:64,y:64},obstacleCollision={x:-4,y:-4,width:8,height:8};
  let obstacleEnabled=true,hiddenEnabled=false;
  const actor:NavigationActor={shape:()=>({collision:ownCollision}),position:()=>ownPosition,enabled:()=>true};
  const obstacle:NavigationActor={shape:()=>({collision:obstacleCollision}),position:()=>obstaclePosition,enabled:()=>obstacleEnabled};
  const hidden:NavigationActor={shape:()=>({collision:{x:-4,y:-4,width:8,height:8}}),position:()=>({x:80,y:80}),enabled:()=>hiddenEnabled};
  world.register(actor);const unregister=world.register(obstacle);world.register(hidden);
  const snapshot=world.captureStandability(actor);
  assert.equal(snapshot.canStand(ownPosition),true,'自身不阻挡查询');
  ownPosition.x=120;ownCollision.width=40;obstaclePosition.x=112;obstacleCollision.x=-40;obstacleEnabled=false;hiddenEnabled=true;
  map.blocked[6*16+6]=true;world.bounds.width=64;unregister();
  world.register({shape:()=>({collision:{x:-4,y:-4,width:8,height:8}}),position:()=>({x:96,y:96}),enabled:()=>true});
  assert.deepEqual(snapshot.start,{x:16,y:16});
  assert.equal(snapshot.bounds.width,128);
  assert.equal(snapshot.canStand({x:64,y:64}),false,'已移动、禁用及注销的障碍仍保留捕获时占位');
  assert.equal(snapshot.canStand({x:80,y:80}),true,'捕获时隐藏的实体不参与查询');
  assert.equal(snapshot.canStand({x:96,y:96}),true,'后注册的实体不参与旧查询');
  assert.equal(snapshot.canStand({x:48,y:48}),true,'捕获后的地形变化不改变旧查询');
  assert.equal(snapshot.canStand({x:112,y:32}),true,'捕获后的边界与自身形状变化不改变旧查询');
  assert.equal(world.canStand(actor,{x:48,y:48}),false,'实时查询仍读取当前地形');
});

test('an unvisited point uses frozen occupancy and completed routes are checked against live movement',()=>{
  const world=new NavigationWorld({name:'frame',bounds:{x:0,y:0,width:160,height:160}});
  const start={x:16,y:16},target={x:128,y:128};
  const actor:NavigationActor={shape:()=>({collision:{x:-4,y:-4,width:8,height:8}}),position:()=>start,enabled:()=>true};
  const obstaclePosition={x:120,y:40};
  const obstacle:NavigationActor={shape:()=>({collision:{x:-4,y:-4,width:8,height:8}}),position:()=>obstaclePosition,enabled:()=>true};
  world.register(actor);world.register(obstacle);
  const snapshot=world.captureStandability(actor);
  const search=createPathSearch(snapshot.start,{bounds:snapshot.bounds,canStand:snapshot.canStand,
    isGoal:point=>point.x===target.x&&point.y===target.y,heuristic:point=>Math.hypot(point.x-target.x,point.y-target.y)});
  assert.equal(search.step(1).status,'pending');
  obstaclePosition.x=64;obstaclePosition.y=64;
  const completed=finish(search,1);
  assert.equal(completed.status,'found');
  if(completed.status!=='found')return;
  assert.ok(completed.path.some(point=>point.x===64&&point.y===64),'后续尚未展开的位置也必须使用冻结占位');
  let previous=snapshot.start;
  const liveRouteClear=completed.path.every(point=>{
    const allowed=canTraverse(previous,point,p=>world.canStand(actor,p));previous=point;return allowed;
  });
  assert.equal(liveRouteClear,false,'旧快照路线不能绕过当前动态碰撞检查');
});
