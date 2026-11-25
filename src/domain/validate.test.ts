import { loadFixture } from '../mocks/fixture';
import { A, B, C } from '../test/configs';
import { validate } from './validate';

const { menu } = loadFixture();
const run = (selection: Record<string, number>) => validate(selection, menu.groups, menu.rules);
const messages = (selection: Record<string, number>) => run(selection).map((v) => v.message);

describe('validate (Part A)', () => {
  it('accepts configurations A, B and C', () => {
    expect(run(A)).toEqual([]);
    expect(run(B)).toEqual([]);
    expect(run(C)).toEqual([]);
  });

  it('accepts Scrambled x1 + Fried x1', () => {
    expect(run({ toast: 1, scrambled: 1, fried: 1, sausage: 1 })).toEqual([]);
  });

  it('TC-01: Scrambled x3 breaks the eggs step', () => {
    const violations = run({ toast: 1, scrambled: 3, sausage: 1 });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ code: 'group_step', groupId: 'eggs' });
    expect(violations[0]!.message).toBe('Eggs total must be 2-6 in steps of 2 (currently 3).');
  });

  it('TC-02: Croissant + 3 extras breaks the override (max 2), not the base max', () => {
    const violations = run({ croissant: 1, fried: 2, sausage: 1, hashbrown: 1, mushroom: 1, cheese: 1 });
    expect(violations).toEqual([
      expect.objectContaining({
        code: 'override_max',
        groupId: 'extras',
        ruleId: 'R3',
        message: 'Extras max is 2 when Croissant is selected (currently 3).',
      }),
    ]);
  });

  it('the override wins over the base limit even though 3 <= base max 4', () => {
    expect(run({ toast: 1, fried: 2, sausage: 1, hashbrown: 1, mushroom: 1, cheese: 1 })).toEqual([]);
  });

  it('TC-03: Hollandaise with only Fried eggs is blocked', () => {
    expect(run({ toast: 1, fried: 2, sausage: 1, hollandaise: 1 })).toEqual([
      expect.objectContaining({
        code: 'requires',
        ruleId: 'R1',
        groupId: 'sauce',
        message: 'Hollandaise requires Scrambled or Omelette.',
      }),
    ]);
  });

  it('TC-04: Tofu + Beef Bacon and Chili + Hollandaise are both listed', () => {
    const violations = run({ toast: 1, scrambled: 2, tofu: 1, bacon: 1, chili: 1, hollandaise: 1 });
    expect(violations.map((v) => v.ruleId)).toEqual(['R2', 'R4']);
    expect(messages({ toast: 1, scrambled: 2, tofu: 1, bacon: 1, chili: 1, hollandaise: 1 })).toEqual([
      'Tofu cannot be combined with Beef Bacon.',
      'Chili cannot be combined with Hollandaise.',
    ]);
  });

  it('returns all violations at once, not only the first', () => {
    const violations = run({ scrambled: 3, tofu: 1, sausage: 1, ketchup: 2 });
    expect(violations.map((v) => v.code).sort()).toEqual(
      ['excludes', 'group_max_per_option', 'group_min', 'group_step'].sort(),
    );
  });

  it('checks maxDistinct and min/max', () => {
    expect(run({ toast: 1, paratha: 1, scrambled: 2, sausage: 1 }).map((v) => v.code)).toEqual(['group_max']);
    expect(
      run({ toast: 1, scrambled: 2, sausage: 1, ketchup: 1, chili: 1, hollandaise: 1 }).map((v) => v.code),
    ).toContain('group_max_distinct');
    expect(run({ toast: 1, scrambled: 2 }).map((v) => v.code)).toEqual(['group_min']);
  });

  it('flags option ids that are not on the menu', () => {
    expect(run({ ...A, caviar: 1 }).map((v) => v.code)).toEqual(['unknown_option']);
  });
});
