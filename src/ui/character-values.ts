import type { CharacterPanel } from '../domain/character-stats.ts';

/** Native character-menu order; rates are stored in thousandths. */
export function characterCombatValues(panel: CharacterPanel): string[] {
  const percent = (value: number) => `${(value / 10).toFixed(1)}%`;
  return [String(panel.physicalAttack), String(panel.magicAttack), percent(panel.criticalRate),
    percent(panel.hitRate), percent(panel.criticalDamage), String(panel.defense),
    percent(panel.physicalResistance), percent(panel.magicResistance), percent(panel.evasionRate),
    percent(panel.weaponBlock), percent(panel.shieldBlock)];
}
