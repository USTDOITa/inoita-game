import test from 'node:test';
import assert from 'node:assert/strict';
import type { CharacterVisual } from '../src/rendering/characters.ts';
import { applyCharacterVisibility,setCharacterStealth } from '../src/rendering/character-visibility.ts';

const layer=(alpha=1)=>({alpha,setAlpha(value:number){this.alpha=value;return this;}});

test('stealth multiplies body opacity, preserves death fades and restores original layer opacity',()=>{
  const first=layer(.8),second=layer(),container={alpha:.3};
  const character={layers:[first,second],container} as unknown as CharacterVisual;
  setCharacterStealth(character,true);
  assert.deepEqual([first.alpha,second.alpha,container.alpha],[.4,.5,.3]);
  setCharacterStealth(character,true);
  assert.deepEqual([first.alpha,second.alpha],[.4,.5]);
  setCharacterStealth(character,false);
  assert.deepEqual([first.alpha,second.alpha,container.alpha],[.8,1,.3]);
});

test('replacement animation layers inherit stealth without changing another character',()=>{
  const character={layers:[layer()]} as unknown as CharacterVisual;
  const other={layers:[layer(.7)]} as unknown as CharacterVisual;
  setCharacterStealth(character,true);
  character.layers=[layer()] as unknown as CharacterVisual['layers'];
  applyCharacterVisibility(character);applyCharacterVisibility(other);
  assert.equal(character.layers[0].alpha,.5);assert.equal(other.layers[0].alpha,.7);
  setCharacterStealth(character,false);assert.equal(character.layers[0].alpha,1);
});
