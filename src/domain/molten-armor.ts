import {attackSplashTargets} from './attack-splash.ts';
import type {Combatant} from './combat.ts';
import {calculateEffectiveDefense} from './physical-hit.ts';
import type {Point} from './navigation.ts';

type MoltenDefenseSource=
  | {kind:'character';defense:number;defenseRate:number}
  | {kind:'monster';physicalAttack:number};

export function moltenReflectionDamage(source:MoltenDefenseSource,ratePerThousand:number):number {
  const basis=source.kind==='monster'?Math.max(0,source.physicalAttack):calculateEffectiveDefense(source.defense,source.defenseRate);
  return Math.trunc(basis*Math.max(0,ratePerThousand)/1000);
}

/** Zero thresholds still consume the native 1..999 roll; zero damage can succeed. */
export function rollMoltenSplash(reflection:number,chanceThreshold:number,random:()=>number=Math.random):number|undefined {
  return 1+Math.floor(random()*999)<chanceThreshold?Math.trunc(reflection/2):undefined;
}

/** Candidate order is actor registration order. The original attacker can occupy one of 16 slots. */
export function moltenSplashTargets(source:Combatant,center:Point,candidates:readonly Combatant[],attackerId:string):Combatant[] {
  return attackSplashTargets(source,center,candidates,4).filter(target=>target.id!==attackerId);
}
