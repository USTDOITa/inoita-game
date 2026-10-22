import type { PlacedEnemy, EnemyDefinition } from './battle.ts';
import { EnemyRoster } from './enemy-roster.ts';
import type { CampaignEnemyPlacement, EnemySpawn, WorldMap } from './content.ts';
import type { Session } from './session.ts';
import type { StoryEncounter } from './story-world.ts';

export type WorldSpawn = EnemySpawn | CampaignEnemyPlacement;

/**
 * 按主角等级选择地图的敌人档位。与进图预取共用；不触碰 Session，
 * 所以预取可以在不切换到目标图的情况下算出它可能出现的敌人。
 */
export function selectMapSpawns(map:WorldMap,questSpawns:readonly CampaignEnemyPlacement[],heroLevel:number):WorldSpawn[]{
  const raw=map.enemySpawns??[];
  const tiers=[...new Set(raw.flatMap(spawn=>spawn.tierLevel===undefined?[]:[spawn.tierLevel]))];
  const selected=tiers.sort((a,b)=>Math.abs(a-heroLevel)-Math.abs(b-heroLevel)||a-b)[0];
  return [...raw.filter(spawn=>spawn.tierLevel===undefined||spawn.tierLevel===selected),...questSpawns];
}

/** One map's enemy roster. Stable spawn IDs and combat resources live in Session. */
export class WorldEnemyRoster extends EnemyRoster {
  readonly session:Session;
  private readonly mapSpawns: readonly WorldSpawn[];
  private readonly mapId:string;
  get spawns(): readonly WorldSpawn[] {
    return [...this.mapSpawns.filter(spawn=>this.session.storyWorld.enemyAvailable(this.mapId,spawn.enemyId)),...this.session.storyWorld.enemySpawns(this.mapId),...this.session.chests.spawns,...this.session.storyWorld.activeEncounters
      .filter(encounter=>encounter.map===this.mapId).flatMap(encounter=>encounter.spawns.map(spawn=>({
        ...spawn,id:encounterSpawnId(encounter.id,spawn.id),respawn:false as const
      })))];
  }
  private readonly sources = new Map<string,WorldSpawn>();
  constructor(session:Session,map:WorldMap,questSpawns:readonly CampaignEnemyPlacement[],heroLevel:number){
    super();
    this.session=session;
    this.mapId=map.id;
    session.enterMap(map.id,map.questItemSpawns??[],map);
    this.setPartySize(session.party?.activeSize??1,[]);
    this.mapSpawns=selectMapSpawns(map,questSpawns,heroLevel);
    for(const spawn of this.spawns)this.sources.set(spawn.id,spawn);
    this.refresh();
  }
  source(id:string):WorldSpawn|undefined{return this.sources.get(id);}
  completedEncounters():readonly StoryEncounter[]{
    return this.session.storyWorld.activeEncounters.filter(encounter=>encounter.map===this.mapId&&encounter.spawns.length>0&&
      encounter.spawns.every(spawn=>{const state=this.session.enemyVitals(encounterSpawnId(encounter.id,spawn.id));
        return state.deadUntil!==undefined&&!state.capture;}));
  }
  override setPartySize(size:number,definitions:readonly EnemyDefinition[]):void{
    if(size===this.partySize)return;
    super.setPartySize(size,definitions);
    for(const placed of this.enemies){const definition=definitions.find(enemy=>enemy.id===placed.enemyId);
      if(!definition)continue;
      const snapshot=this.enemySnapshot(placed.key,definition,this.session.hero?.level??1);
      if(snapshot)this.session.setEnemyVitals(placed.key,snapshot.health,snapshot.mana);
    }
  }
  refresh():{added:PlacedEnemy[];removed:string[]}{
    const added:PlacedEnemy[]=[],removed:string[]=[];
    const spawns=this.spawns,active=new Set(spawns.map(spawn=>spawn.id));
    for(const placed of [...this.enemies]){
      const spawn=this.sources.get(placed.key);
      if(spawn&&(!active.has(spawn.id)||!this.session.canSpawnEnemy(spawn))){super.removeEnemy(placed.key);removed.push(placed.key);}
    }
    for(const spawn of spawns){
      this.sources.set(spawn.id,spawn);
      if(!this.session.canSpawnEnemy(spawn)||this.enemies.some(enemy=>enemy.key===spawn.id))continue;
      const vitals=this.session.enemyVitals(spawn.id);
      const placed:PlacedEnemy={key:spawn.id,enemyId:spawn.enemyId,x:spawn.x,y:spawn.y,health:vitals.health,mana:vitals.mana};
      this.restoreEnemy(placed);added.push(placed);
    }
    return {added,removed};
  }
  override setEnemyHealth(key:string,value:number,definition:EnemyDefinition):void {
    super.setEnemyHealth(key,value,definition);
    const snapshot=this.enemySnapshot(key,definition,this.session.hero?.level??1);
    if(snapshot)this.session.setEnemyVitals(key,snapshot.health,snapshot.mana);
  }
  override setEnemyMana(key:string,value:number,definition:EnemyDefinition):void {
    super.setEnemyMana(key,value,definition);
    const snapshot=this.enemySnapshot(key,definition,this.session.hero?.level??1);
    if(snapshot)this.session.setEnemyVitals(key,snapshot.health,snapshot.mana);
  }
}

/** Each encounter occurrence owns separate combat resources, even on the same map. */
export function encounterSpawnId(encounter:string,spawn:string):string{return `${encounter}:${spawn}`;}

/** 剧情移除以当前实例为准；它不产生玩家击杀、奖励或掉落。 */
export function applyStoryEnemyRemovals(session:Session,map:string,enemies:readonly Pick<PlacedEnemy,'key'|'enemyId'>[],remove:(key:string)=>void):void {
  const removed=new Set<string>();
  for(const command of session.storyWorld.pendingEnemyRemovals){
    if(command.map&&command.map!==map)continue;
    const matches=enemies.filter(enemy=>!removed.has(enemy.key)&&enemy.enemyId===command.enemyId);
    for(const enemy of command.all?matches:matches.slice(0,1)){
      session.removeStoryEnemy(enemy.key);remove(enemy.key);removed.add(enemy.key);
    }
  }
  session.storyWorld.consumeEnemyRemovals();
}
