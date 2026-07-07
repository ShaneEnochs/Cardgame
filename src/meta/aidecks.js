// Prebuilt decks for the AI opponent. The AI doesn't own a collection — it
// draws from the whole pool, one themed deck per match, picked at random.

export const AI_DECKS = [
  {
    id: 'ai_dragons',
    name: 'Emberwing Flight',
    heroPower: 'emberspark',
    cards: [
      'kobold', 'kobold',
      'red_wyrmling', 'red_wyrmling',
      'faerie_dragon', 'faerie_dragon',
      'wind_drake', 'wind_drake',
      'fire_drake', 'fire_drake',
      'white_tundra', 'white_tundra',
      'guard_drake', 'guard_drake',
      'brass_desert', 'brass_desert',
      'young_red', 'young_red',
      'stone_drake', 'stone_drake',
      'gem_emerald', 'gem_emerald',
      'ashscale_red', 'ashscale_red',
      'copper_canyon', 'copper_canyon',
      'gem_topaz', 'gem_topaz',
      'adult_red',
      'ancient_red',
    ],
  },
  {
    id: 'ai_undead',
    name: 'Gravebloom',
    heroPower: 'mending_hand',
    cards: [
      'human_skeleton', 'human_skeleton',
      'flaming_skeleton', 'flaming_skeleton',
      'shadow', 'shadow',
      'shambling_zombie', 'shambling_zombie',
      'vampire_spawn', 'vampire_spawn',
      'crypt_ghoul', 'crypt_ghoul',
      'plague_zombie', 'plague_zombie',
      'spectre', 'spectre',
      'wight', 'wight',
      'bone_naga', 'bone_naga',
      'banshee', 'banshee',
      'wraith', 'wraith',
      'giant_skeleton', 'giant_skeleton',
      'true_vampire', 'true_vampire',
      'dread_wraith',
      'dracolich',
    ],
  },
  {
    id: 'ai_constructs',
    name: 'Stoneworks',
    heroPower: 'tinkers_ward',
    cards: [
      'sprocket', 'sprocket',
      'flying_sword', 'flying_sword',
      'rug_smothering', 'rug_smothering',
      'animated_armor', 'animated_armor',
      'clockwork_defender', 'clockwork_defender',
      'gargoyle', 'gargoyle',
      'crystal_golem', 'crystal_golem',
      'helmed_horror', 'helmed_horror',
      'clay_golem', 'clay_golem',
      'shield_guardian', 'shield_guardian',
      'flesh_golem', 'flesh_golem',
      'stone_golem', 'stone_golem',
      'iron_golem', 'iron_golem',
      'stone_giant', 'stone_giant',
      'storm_giant',
      'clockwork_titan',
    ],
  },
];

export function randomAiDeck(rand = Math.random) {
  return AI_DECKS[Math.floor(rand() * AI_DECKS.length)];
}
