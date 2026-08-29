// Structural validation for Character templates embedded in content packs.
//
// This deliberately validates the runtime-facing shape rather than game-rule
// policy. For example, numeric state must be finite, but this module does not
// decide whether a campaign permits negative XP or a particular Wounds value.

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonBlankString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isFiniteInteger = (value: unknown): value is number =>
  isFiniteNumber(value) && Number.isInteger(value);

const AP_KEYS = ['head', 'arm_l', 'arm_r', 'body', 'leg_l', 'leg_r', 'shield'] as const;

function requireString(
  object: JsonObject,
  key: string,
  where: string,
  errors: string[],
  nonBlank = false,
): void {
  const value = object[key];
  if (typeof value !== 'string') {
    errors.push(`${where} "${key}" must be a string.`);
  } else if (nonBlank && value.trim().length === 0) {
    errors.push(`${where} "${key}" must be a nonblank string.`);
  }
}

function optionalNonBlankString(
  object: JsonObject,
  key: string,
  where: string,
  errors: string[],
): void {
  if (object[key] !== undefined && !isNonBlankString(object[key])) {
    errors.push(`${where} "${key}" must be a nonblank string when provided.`);
  }
}

function requireFiniteNumber(
  object: JsonObject,
  key: string,
  where: string,
  errors: string[],
): void {
  if (!isFiniteNumber(object[key])) {
    errors.push(`${where} "${key}" must be a finite number.`);
  }
}

function requireObject(
  object: JsonObject,
  key: string,
  where: string,
  errors: string[],
): JsonObject | undefined {
  const value = object[key];
  if (!isObject(value)) {
    errors.push(`${where} "${key}" must be an object.`);
    return undefined;
  }
  return value;
}

function requireArray(
  object: JsonObject,
  key: string,
  where: string,
  errors: string[],
): unknown[] | undefined {
  const value = object[key];
  if (!Array.isArray(value)) {
    errors.push(`${where} "${key}" must be an array.`);
    return undefined;
  }
  return value;
}

function validateStringArray(values: unknown[], where: string, errors: string[]): void {
  values.forEach((value, index) => {
    if (!isNonBlankString(value)) {
      errors.push(`${where}[${index}] must be a nonblank string.`);
    }
  });
}

function validateCareerRanks(character: JsonObject, where: string, errors: string[]): void {
  const ranks = requireArray(character, 'careerRanks', where, errors);
  if (!ranks) return;

  const levels = new Set<number>();
  ranks.forEach((value, index) => {
    const rankWhere = `${where}.careerRanks[${index}]`;
    if (!isObject(value)) {
      errors.push(`${rankWhere} must be an object.`);
      return;
    }
    if (!isFiniteInteger(value.level) || value.level < 1) {
      errors.push(`${rankWhere} "level" must be a finite integer greater than or equal to 1.`);
    } else if (levels.has(value.level)) {
      errors.push(`${rankWhere} "level" duplicates career level ${value.level}.`);
    } else {
      levels.add(value.level);
    }
    requireString(value, 'name', rankWhere, errors, true);
    requireString(value, 'status', rankWhere, errors, true);
  });
}

function validateCharacteristics(
  character: JsonObject,
  where: string,
  errors: string[],
): Set<string> | undefined {
  const characteristics = requireArray(character, 'characteristics', where, errors);
  if (!characteristics) return undefined;

  const keys = new Set<string>();
  characteristics.forEach((value, index) => {
    const charWhere = `${where}.characteristics[${index}]`;
    if (!isObject(value)) {
      errors.push(`${charWhere} must be an object.`);
      return;
    }
    requireString(value, 'key', charWhere, errors, true);
    requireString(value, 'name', charWhere, errors, true);
    requireString(value, 'short', charWhere, errors, true);
    requireFiniteNumber(value, 'init', charWhere, errors);
    requireFiniteNumber(value, 'adv', charWhere, errors);

    if (isNonBlankString(value.key)) {
      if (keys.has(value.key)) errors.push(`${charWhere} "key" duplicates characteristic "${value.key}".`);
      else keys.add(value.key);
    }
  });
  return keys;
}

function validateSkills(
  character: JsonObject,
  where: string,
  errors: string[],
  characteristicKeys: ReadonlySet<string> | undefined,
): void {
  const skills = requireArray(character, 'skills', where, errors);
  if (!skills) return;

  skills.forEach((value, index) => {
    const skillWhere = `${where}.skills[${index}]`;
    if (!isObject(value)) {
      errors.push(`${skillWhere} must be an object.`);
      return;
    }
    optionalNonBlankString(value, 'definitionId', skillWhere, errors);
    requireString(value, 'name', skillWhere, errors, true);
    requireString(value, 'char', skillWhere, errors, true);
    if (characteristicKeys && isNonBlankString(value.char) && !characteristicKeys.has(value.char)) {
      errors.push(`${skillWhere} "char" references unknown characteristic "${value.char}".`);
    }
    requireFiniteNumber(value, 'adv', skillWhere, errors);
    if (typeof value.career !== 'boolean') {
      errors.push(`${skillWhere} "career" must be a boolean.`);
    }
    if (value.advanced !== undefined && typeof value.advanced !== 'boolean') {
      errors.push(`${skillWhere} "advanced" must be a boolean when provided.`);
    }
    optionalNonBlankString(value, 'grouped', skillWhere, errors);
  });
}

const normalizedTalentIdentityPart = (value: string): string => value.trim().toLowerCase();

function talentIdentity(talent: JsonObject): string | undefined {
  if (talent.definitionId !== undefined) {
    if (!isNonBlankString(talent.definitionId)) return undefined;
    if (talent.specialization !== undefined && !isNonBlankString(talent.specialization)) return undefined;
    return `definition:${normalizedTalentIdentityPart(talent.definitionId)}`
      + `|specialization:${isNonBlankString(talent.specialization)
        ? normalizedTalentIdentityPart(talent.specialization)
        : ''}`;
  }
  return isNonBlankString(talent.name)
    ? `name:${normalizedTalentIdentityPart(talent.name)}`
    : undefined;
}

function validateTalents(character: JsonObject, where: string, errors: string[]): void {
  const talents = requireArray(character, 'talents', where, errors);
  if (!talents) return;

  const identities = new Set<string>();
  talents.forEach((value, index) => {
    const talentWhere = `${where}.talents[${index}]`;
    if (!isObject(value)) {
      errors.push(`${talentWhere} must be an object.`);
      return;
    }
    requireString(value, 'name', talentWhere, errors, true);
    requireString(value, 'desc', talentWhere, errors, true);
    if (!isFiniteInteger(value.times) || value.times < 1) {
      errors.push(`${talentWhere} "times" must be a finite integer greater than or equal to 1.`);
    }
    if (typeof value.career !== 'boolean') {
      errors.push(`${talentWhere} "career" must be a boolean.`);
    }
    optionalNonBlankString(value, 'definitionId', talentWhere, errors);
    optionalNonBlankString(value, 'specialization', talentWhere, errors);

    const identity = talentIdentity(value);
    if (identity) {
      if (identities.has(identity)) {
        errors.push(`${talentWhere} duplicates talent identity "${identity}".`);
      } else {
        identities.add(identity);
      }
    }
  });
}

function validateWeapons(character: JsonObject, where: string, errors: string[]): void {
  const weapons = requireArray(character, 'weapons', where, errors);
  if (!weapons) return;

  weapons.forEach((value, index) => {
    const weaponWhere = `${where}.weapons[${index}]`;
    if (!isObject(value)) {
      errors.push(`${weaponWhere} must be an object.`);
      return;
    }
    requireString(value, 'name', weaponWhere, errors, true);
    requireString(value, 'group', weaponWhere, errors, true);
    requireFiniteNumber(value, 'enc', weaponWhere, errors);
    requireString(value, 'dmg', weaponWhere, errors, true);
    optionalNonBlankString(value, 'reach', weaponWhere, errors);
    optionalNonBlankString(value, 'range', weaponWhere, errors);
    const qualities = requireArray(value, 'qual', weaponWhere, errors);
    if (qualities) validateStringArray(qualities, `${weaponWhere}.qual`, errors);
  });
}

function validateArmour(character: JsonObject, where: string, errors: string[]): void {
  const armour = requireArray(character, 'armour', where, errors);
  if (!armour) return;

  armour.forEach((value, index) => {
    const armourWhere = `${where}.armour[${index}]`;
    if (!isObject(value)) {
      errors.push(`${armourWhere} must be an object.`);
      return;
    }
    requireString(value, 'name', armourWhere, errors, true);
    requireFiniteNumber(value, 'enc', armourWhere, errors);
    requireFiniteNumber(value, 'ap', armourWhere, errors);
    const locations = requireArray(value, 'locs', armourWhere, errors);
    if (locations) validateStringArray(locations, `${armourWhere}.locs`, errors);
    const qualities = requireArray(value, 'qual', armourWhere, errors);
    if (qualities) validateStringArray(qualities, `${armourWhere}.qual`, errors);
  });
}

function validateConditions(character: JsonObject, where: string, errors: string[]): void {
  const conditions = requireArray(character, 'conditions', where, errors);
  if (!conditions) return;

  conditions.forEach((value, index) => {
    const conditionWhere = `${where}.conditions[${index}]`;
    if (!isObject(value)) {
      errors.push(`${conditionWhere} must be an object.`);
      return;
    }
    requireString(value, 'type', conditionWhere, errors, true);
    if (!isFiniteInteger(value.stacks) || value.stacks < 0) {
      errors.push(`${conditionWhere} "stacks" must be a finite integer greater than or equal to 0.`);
    }
  });
}

function validateCriticals(character: JsonObject, where: string, errors: string[]): void {
  const criticals = requireArray(character, 'criticals', where, errors);
  if (!criticals) return;

  criticals.forEach((value, index) => {
    const criticalWhere = `${where}.criticals[${index}]`;
    if (!isObject(value)) {
      errors.push(`${criticalWhere} must be an object.`);
      return;
    }
    // Systems without hit-location combat store an empty location.
    requireString(value, 'loc', criticalWhere, errors);
    requireFiniteNumber(value, 'roll', criticalWhere, errors);
    requireString(value, 'name', criticalWhere, errors, true);
    requireString(value, 'effect', criticalWhere, errors, true);
    requireFiniteNumber(value, 'days', criticalWhere, errors);
  });
}

function validateTrappings(character: JsonObject, where: string, errors: string[]): void {
  const trappings = requireArray(character, 'trappings', where, errors);
  if (!trappings) return;

  trappings.forEach((value, index) => {
    const trappingWhere = `${where}.trappings[${index}]`;
    if (!isObject(value)) {
      errors.push(`${trappingWhere} must be an object.`);
      return;
    }
    requireString(value, 'name', trappingWhere, errors, true);
    requireFiniteNumber(value, 'enc', trappingWhere, errors);
  });
}

function validateParty(character: JsonObject, where: string, errors: string[]): void {
  const party = requireObject(character, 'party', where, errors);
  if (!party) return;
  requireString(party, 'name', `${where}.party`, errors);
  requireString(party, 'short', `${where}.party`, errors);

  const members = requireArray(party, 'members', `${where}.party`, errors);
  if (!members) return;
  members.forEach((value, index) => {
    const memberWhere = `${where}.party.members[${index}]`;
    if (!isObject(value)) {
      errors.push(`${memberWhere} must be an object.`);
      return;
    }
    requireString(value, 'name', memberWhere, errors, true);
    requireString(value, 'role', memberWhere, errors, true);
  });
}

/**
 * Validate one Character-shaped content-pack entry. The enclosing pack
 * validator remains responsible for section-level id uniqueness.
 */
export function validateCharacterTemplate(character: JsonObject, where: string): string[] {
  const errors: string[] = [];

  for (const key of ['name', 'species', 'class', 'career', 'careerLevelName', 'status', 'initials', 'accent']) {
    requireString(character, key, where, errors, true);
  }
  for (const key of ['height', 'hair', 'eyes', 'motivation', 'ambitionsShort', 'ambitionsLong']) {
    requireString(character, key, where, errors);
  }
  optionalNonBlankString(character, 'raceId', where, errors);
  optionalNonBlankString(character, 'careerId', where, errors);

  if (!isFiniteInteger(character.careerLevel) || character.careerLevel < 1) {
    errors.push(`${where} "careerLevel" must be a finite integer greater than or equal to 1.`);
  }
  for (const key of [
    'age', 'fate', 'fortune', 'resilience', 'resolve', 'xpCurrent', 'xpSpent',
    'corruption', 'sin', 'movement',
  ]) {
    requireFiniteNumber(character, key, where, errors);
  }

  validateCareerRanks(character, where, errors);

  const wounds = requireObject(character, 'wounds', where, errors);
  if (wounds) {
    requireFiniteNumber(wounds, 'current', `${where}.wounds`, errors);
    requireFiniteNumber(wounds, 'max', `${where}.wounds`, errors);
  }

  const wealth = requireObject(character, 'wealth', where, errors);
  if (wealth) {
    for (const [unit, amount] of Object.entries(wealth)) {
      if (unit.trim().length === 0) errors.push(`${where}.wealth contains a blank currency key.`);
      if (!isFiniteNumber(amount)) errors.push(`${where}.wealth["${unit}"] must be a finite number.`);
    }
  }

  const characteristicKeys = validateCharacteristics(character, where, errors);
  validateSkills(character, where, errors, characteristicKeys);
  validateTalents(character, where, errors);
  validateWeapons(character, where, errors);
  validateArmour(character, where, errors);

  const ap = requireObject(character, 'ap', where, errors);
  if (ap) {
    for (const key of AP_KEYS) requireFiniteNumber(ap, key, `${where}.ap`, errors);
  }

  validateConditions(character, where, errors);
  validateCriticals(character, where, errors);
  validateTrappings(character, where, errors);
  validateParty(character, where, errors);

  const psychology = requireArray(character, 'psychology', where, errors);
  if (psychology) validateStringArray(psychology, `${where}.psychology`, errors);

  const mutations = requireArray(character, 'mutations', where, errors);
  if (mutations) {
    mutations.forEach((value, index) => {
      const mutationWhere = `${where}.mutations[${index}]`;
      if (!isObject(value)) errors.push(`${mutationWhere} must be an object.`);
      else requireString(value, 'name', mutationWhere, errors, true);
    });
  }

  for (const key of ['isCaster', 'isAnointed']) {
    if (character[key] !== undefined && typeof character[key] !== 'boolean') {
      errors.push(`${where} "${key}" must be a boolean when provided.`);
    }
  }
  for (const key of ['deity', 'spellLore']) optionalNonBlankString(character, key, where, errors);
  for (const key of ['knownSpells', 'knownPrayers']) {
    if (character[key] !== undefined) {
      const refs = requireArray(character, key, where, errors);
      if (refs) validateStringArray(refs, `${where}.${key}`, errors);
    }
  }

  return errors;
}
