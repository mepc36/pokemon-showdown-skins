import $ from 'jquery';
import {Dex} from '@pkmn/dex';
import {DefaultText} from '../vendor/text/default';
import {MovesText} from '../vendor/text/moves';
import {AbilitiesText} from '../vendor/text/abilities';
import {ItemsText} from '../vendor/text/items';
import {PokedexText} from '../vendor/text/pokedex';
import {TagsText} from '../vendor/text/tags';
import * as Names from '../vendor/text/names';

// The upstream replay engine expects these data tables before module evaluation.
Object.assign(window, {
  $, jQuery: $, BattlePokedex: structuredClone(Dex.data.Species),
  BattleMovedex: structuredClone(Dex.data.Moves), BattleAbilities: structuredClone(Dex.data.Abilities),
  BattleItems: structuredClone(Dex.data.Items), BattleTypeChart: structuredClone(Dex.data.Types),
  BattleAliases: structuredClone(Dex.data.Aliases),
  BattlePokemonIconIndexes: {}, BattlePokemonIconIndexesLeft: {},
  BattleAvatarNumbers: {'1': 'lucas', '2': 'dawn'},
  BattleText: {en: {...Names, Default: DefaultText, Moves: MovesText, Abilities: AbilitiesText,
    Items: ItemsText, Pokedex: PokedexText, Tags: TagsText}},
});
