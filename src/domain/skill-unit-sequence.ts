import type { CombatUnit } from './battle.ts';

export type SkillUnitOutcome = 'success' | 'failure' | 'skipped';

export interface ResolvedSkillUnit {
  cueIndex: number;
  targetId: string;
  outcome: SkillUnitOutcome;
}

interface SkillUnitSequencePort {
  /** Query when this cue starts; the caller owns target selection and reuse. */
  targets(cueIndex: number): readonly string[];
  /** Prepare after target selection, including an empty or reused list, and before any target attempt. */
  prepare?(cueIndex: number): void;
  /** Skipped means no attempt, such as a target that has left the battle. */
  unit(cueIndex: number, targetId: string): SkillUnitOutcome;
  /** Runs before the next target or cue, including when this sequence skips one. */
  resolved?(result: ResolvedSkillUnit): void;
}

/** One direct execution or one transition arrival has its own failure history. */
export function resolveSkillUnitSequence(
  units: readonly Pick<CombatUnit, 'effect'>[],
  port: SkillUnitSequencePort,
): ResolvedSkillUnit[] {
  const failedTargets: string[] = [];
  const results: ResolvedSkillUnit[] = [];
  for (const [cueIndex, unit] of units.entries()) {
    const bypassFailure = unit.effect === 'set-attribute' || unit.effect === 'clear-attribute';
    const targets = port.targets(cueIndex).slice(0, 16);
    port.prepare?.(cueIndex);
    for (const targetId of targets) {
      const outcome = !bypassFailure && failedTargets.includes(targetId)
        ? 'skipped' : port.unit(cueIndex, targetId);
      // Bypass units can fail again; repeated entries also consume the 16 slots.
      if (outcome === 'failure' && failedTargets.length < 16) failedTargets.push(targetId);
      const result = { cueIndex, targetId, outcome };
      results.push(result);
      port.resolved?.(result);
    }
  }
  return results;
}
