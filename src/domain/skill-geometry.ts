import type { CollisionBox, Facing } from './content.ts';
import type { SummonPlacement } from './battle.ts';
import type { Point } from './navigation.ts';
import { projectileStep } from './basic-attack.ts';

/** 固定落点的过渡最多前进 switchFrame + 1 次，最后一次强制抵达。 */
export function positionTransitionStep(start:Point,target:Point,stepPx:number,completedSteps:number,switchFrame:number){
  return completedSteps>=switchFrame ? {position:{...target},arrived:true} : projectileStep(start,target,stepPx);
}

/**
 * 原版搜索带几何；按八像素网格挑第一个可站位置。
 * 找不到就返回 `undefined`：落点必须由调用方另找一个合法位置，不再拿主人坐标冒充落点。
 */
export function planSummonSpot(position:Point,box:CollisionBox,facing:Facing,placement:SummonPlacement,
  canStand:(point:Point)=>boolean):Point|undefined{
  const start=['south','west','north','east'].indexOf(facing);
  const gap=placement.searchGapPx,extent=placement.searchExtentPx;
  for(const turn of [0,1,3,2]){
    const direction=(start+turn)%4;
    for(let forward=0;forward<=extent;forward+=8)for(let side=-extent;side<=extent;side+=8){
      const point=direction===0?{x:position.x+side,y:position.y+box.y+box.height+gap+forward}
        :direction===1?{x:position.x+box.x-gap-forward,y:position.y+side}
        :direction===2?{x:position.x+side,y:position.y+box.y-gap-forward}
        :{x:position.x+box.x+box.width+gap+forward,y:position.y+side};
      if(canStand(point))return point;
    }
  }
  return undefined;
}
