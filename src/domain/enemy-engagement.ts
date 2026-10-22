import type { EnemyBehavior } from './battle.ts';
import type { GameRectangle } from './navigation.ts';

/** 发现使用脚点距离，仇恨衰减使用矩形距离；全图范围同时覆盖两种口径。 */
export function enemyAwarenessRangeUnits(behavior:EnemyBehavior,bounds:GameRectangle|undefined,sightBonusUnits=0):number {
  const ordinary=Math.max(0,behavior.awarenessRangeUnits)+sightBonusUnits;
  if(behavior.engagement!=='map-wide')return ordinary;
  if(!bounds)throw new Error('全图参战的敌人缺少地图边界');
  return Math.max(ordinary,Math.ceil((bounds.width+bounds.height)/8)+2);
}
