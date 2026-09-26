import { useCharacter, characterKey } from './useCharacter';
import { useCharacteristics } from './useCharacteristics';
import { useStoredState } from './useStoredState';
import { useCareers, useSkillDefs } from '@/content/useContent';
import { careerDefForCharacter } from '@/utils/careers';
import { mergeCharacterSkills, normalizeExtraSkills } from '@/utils/characterSkills';

export function useTestOptions() {
  const { id, template: c } = useCharacter();
  const { list } = useCharacteristics();
  const defs = useSkillDefs();
  const careers = useCareers();
  const [extra] = useStoredState<unknown>(characterKey(id, 'skills.extra'), []);
  const skills = mergeCharacterSkills(c, careerDefForCharacter(careers, c)?.advanceScheme?.skills,
    normalizeExtraSkills(extra), defs);
  const [advances] = useStoredState<Record<string, number>>(characterKey(id, 'skills.adv'),
    Object.fromEntries(skills.map(s => [s.name, s.adv])));
  const options = list.map(ch => ({ id: `char:${ch.key}`, label: ch.name, target: ch.current,
    group: 'Characteristics', disabled: false }));
  const owned = new Set(skills.map(s => s.name));
  // Basic, ungrouped skills can also be tested without purchased advances.
  const available = [...skills, ...defs.filter(d => !d.advanced && !d.grouped && !owned.has(d.name))
    .map(d => ({ ...d, adv: 0, career: false }))];
  for (const skill of available.sort((a, b) => a.name.localeCompare(b.name))) {
    const ch = list.find(candidate => candidate.key === skill.char);
    if (!ch) continue;
    const adv = advances[skill.name] ?? skill.adv;
    options.push({ id: `skill:${skill.name}`, label: skill.name, target: ch.current + adv,
      group: 'Skills', disabled: !!skill.advanced && adv === 0 });
  }
  return options;
}
