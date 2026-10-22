/** 金额以铜币计；原版货币控件最多显示 9999 金 99 银 99 铜。 */
export function splitMoney(amount: number): { gold: number; silver: number; copper: number } {
  const value = Math.min(99_999_999, Math.max(0, Math.floor(amount)));
  return { gold: Math.floor(value / 10_000), silver: Math.floor(value / 100) % 100, copper: value % 100 };
}
