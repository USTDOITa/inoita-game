import { boundedHealth, type TargetStatus } from './status-hud.ts';
import { calculateEnemy, enemyPartySize, type EnemySnapshot } from './enemy-stats.ts';
import type { PlacedEnemy, EnemyDefinition } from './battle.ts';

/** 管理地图敌人及召唤物的实例状态。 */
interface SnapshotCache {
  partySize:number;playerLevel:number;sceneLevel:number;
  health:number|undefined;mana:number|undefined;level:number|undefined;elite:boolean|undefined;
  summonedStats:PlacedEnemy['summonedStats'];
  snapshot:Readonly<EnemySnapshot>;
}

export class EnemyRoster {
  enemies: PlacedEnemy[] = [];
  private enemiesByKey = new Map<string, PlacedEnemy>();
  private snapshotCache = new WeakMap<PlacedEnemy, SnapshotCache>();
  private enemySeq = 0;
  private currentPartySize = 1;
  private enemyListeners = new Set<()=>void>();
  private rebuildKeyIndex():void {
    this.enemiesByKey.clear();
    for(const enemy of this.enemies)this.enemiesByKey.set(enemy.key, enemy);
  }
  get partySize():number { return this.currentPartySize; }
  captureState():{enemies:PlacedEnemy[];sequence:number;partySize:number}{
    return {enemies:structuredClone(this.enemies),sequence:this.enemySeq,partySize:this.currentPartySize};
  }
  restoreState(state:{enemies:PlacedEnemy[];sequence:number;partySize:number}):void{
    this.enemies=structuredClone(state.enemies);this.enemySeq=state.sequence;this.currentPartySize=state.partySize;this.rebuildKeyIndex();this.notifyEnemies();
  }
  subscribeEnemies(listener:()=>void):()=>void { this.enemyListeners.add(listener);return ()=>{this.enemyListeners.delete(listener);}; }
  private notifyEnemies():void { for(const listener of this.enemyListeners)listener(); }
  /** 登记一个敌人并分配实例标识。 */
  placeEnemy(enemyId: string, x: number, y: number): PlacedEnemy {
    const placed: PlacedEnemy = { key: `enemy-${++this.enemySeq}`, enemyId, x, y };
    this.enemies.push(placed); this.enemiesByKey.set(placed.key, placed); this.notifyEnemies();return placed;
  }
  /** Restore a world spawn with its stable instance key and saved resources. */
  restoreEnemy(placed:PlacedEnemy):void {
    if(this.enemies.some(enemy=>enemy.key===placed.key))return;
    const clone={...placed};this.enemies.push(clone);this.enemiesByKey.set(clone.key,clone);this.notifyEnemies();
  }
  /** 移出名单；外观由场景负责销毁。 */
  removeEnemy(key: string): void {
    if(!this.enemiesByKey.has(key)&&!this.enemies.some(enemy=>enemy.key===key))return;
    this.enemies = this.enemies.filter(enemy => enemy.key !== key);this.enemiesByKey.delete(key);this.notifyEnemies();
  }
  /** 更新站位或召唤落点。 */
  moveEnemy(key: string, x: number, y: number): void {
    const placed = this.enemiesByKey.get(key) ?? this.enemies.find(enemy => enemy.key === key);
    if (placed) { placed.x = x; placed.y = y; }
  }
  enemySnapshot(key:string,definition:EnemyDefinition,playerLevel=1,sceneLevel=1):Readonly<EnemySnapshot>|undefined {
    const placed=this.enemiesByKey.get(key)??this.enemies.find(enemy=>enemy.key===key&&enemy.enemyId===definition.id);
    if(!placed||placed.enemyId!==definition.id)return;
    const cached=this.snapshotCache.get(placed);
    if(cached&&cached.partySize===this.partySize&&cached.playerLevel===playerLevel&&cached.sceneLevel===sceneLevel&&
      cached.health===placed.health&&cached.mana===placed.mana&&cached.level===placed.level&&cached.elite===placed.elite&&cached.summonedStats===placed.summonedStats)
      return cached.snapshot;
    const calculated=calculateEnemy(definition,{level:placed.level,elite:placed.elite,partySize:this.partySize,playerLevel,sceneLevel});
    // 召唤物的派生属性覆盖自身数据里的对应项，其余沿用计算值。
    const stats=placed.summonedStats?{...calculated,...placed.summonedStats}:calculated;
    const snapshot=Object.freeze({...stats,id:key,name:definition.name,health:boundedHealth(placed.health??stats.maxHealth,stats.maxHealth),
      mana:boundedHealth(placed.mana??stats.maxMana,stats.maxMana)});
    this.snapshotCache.set(placed,{partySize:this.partySize,playerLevel,sceneLevel,health:placed.health,mana:placed.mana,level:placed.level,elite:placed.elite,summonedStats:placed.summonedStats,snapshot});
    return snapshot;
  }
  enemyStatus(key:string,definition:EnemyDefinition,sceneLevel=1):TargetStatus|undefined {
    const snapshot=this.enemySnapshot(key,definition,1,sceneLevel);
    if(!snapshot)return;
    const {id,name,level,sceneLevel:usesSceneLevel,health,maxHealth}=snapshot;
    return {id,name,level,sceneLevel:usesSceneLevel,health,maxHealth};
  }
  setEnemyHealth(key:string,value:number,definition:EnemyDefinition):void {
    const placed=this.enemiesByKey.get(key)??this.enemies.find(enemy=>enemy.key===key&&enemy.enemyId===definition.id);
    const snapshot=this.enemySnapshot(key,definition);
    if(!placed||!snapshot)return;
    const health=boundedHealth(value,snapshot.maxHealth);
    if(health===snapshot.health)return;
    placed.health=health;this.notifyEnemies();
  }
  setEnemyMana(key:string,value:number,definition:EnemyDefinition):void {
    const placed=this.enemiesByKey.get(key)??this.enemies.find(enemy=>enemy.key===key&&enemy.enemyId===definition.id);
    const snapshot=this.enemySnapshot(key,definition);
    if(!placed||!snapshot)return;
    const mana=boundedHealth(value,snapshot.maxMana);
    if(mana===snapshot.mana)return;
    placed.mana=mana;this.notifyEnemies();
  }
  setPartySize(size:number,definitions:readonly EnemyDefinition[]):void {
    enemyPartySize(size);if(size===this.partySize)return;
    // 先准备全部结果，再一次性写入，订阅者读到的队伍和生命上限保持一致。
    const changes=this.enemies.map(placed=>{
      const definition=definitions.find(enemy=>enemy.id===placed.enemyId);
      if(!definition)throw new Error(`怪物内容缺失：${placed.enemyId}`);
      const before=this.enemySnapshot(placed.key,definition)!;
      const after=calculateEnemy(definition,{level:placed.level,elite:placed.elite,partySize:size});
      const minimumHealth=before.health>0?1:0;
      return {placed,health:placed.health===undefined?undefined:
        Math.max(minimumHealth,Math.trunc(before.health*after.maxHealth/before.maxHealth))};
    });
    this.currentPartySize=size;for(const {placed,health} of changes)placed.health=health;
    this.notifyEnemies();
  }
}
