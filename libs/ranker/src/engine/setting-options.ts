// The sport's own settings (SPORT.settings): where each sits (the settings menu's sections, or the
// footer's dropdowns), and how its value and choices read
import { SPORT } from '@sport/sport';
import { SportSetting, SportSettings } from '@ranker/engine/sport';

export interface SettingOption {
  value: string;
  label: string;
}

export function settingsAt(slot: SportSetting['slot']): SportSetting[] {
  return (SPORT.settings ?? []).filter((setting) => setting.slot === slot);
}

// A choice setting's current choice, as it reads ("PPR")
export function settingText(setting: SportSetting, values: SportSettings): string {
  return setting.options?.[values[setting.key] as string] ?? '';
}

// A choice setting's options, for its dropdown
export function settingOptions(setting: SportSetting): SettingOption[] {
  return Object.entries(setting.options ?? {}).map(([value, label]) => ({ value, label }));
}

// ...or under headers, when the setting groups them
export function settingGroups(setting: SportSetting): { label: string; options: SettingOption[] }[] {
  return (setting.optionGroups ?? []).map((group) => ({
    label: group.label,
    options: Object.entries(group.options).map(([value, label]) => ({ value, label })),
  }));
}
