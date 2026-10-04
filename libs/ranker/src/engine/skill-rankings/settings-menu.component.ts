import { Component, Input, ViewChild } from '@angular/core';
import { MatMenu } from '@angular/material/menu';
import { STAT_BASIS_LABELS, SkillPosition } from '@sport/positions';
import { SPORT } from '@sport/sport';
import { SportSetting } from '@ranker/engine/sport';
import { PositionService, RankerSettings } from '@ranker/engine/position.service';
import { SKILL_UNITS } from '@ranker/engine/unit-scoring';
import { minCount, seasonLength, steppedMin } from '@ranker/engine/playing-time';
import { settingText, settingsAt } from '@ranker/engine/setting-options';

// A switch in the Display section: one of ours, or the sport's (SPORT.settings)
interface MenuSwitch {
  label: string;
  title: string;
  on: () => boolean;
  flip: () => void;
}

// The settings menu (the footer's gear): how stats are counted (Stat Totals, Min Games, the sport's
// format settings) and what the table shows (dividers, colors, combined columns, injured players,
// rookies, unweighted stats, the sport's display settings). Shared by every tab; the rankings re-rank
// on any change (PositionService.settings$).
@Component({
  selector: 'settings-menu',
  templateUrl: './settings-menu.component.html',
  styleUrls: ['../../styles/components/settings-menu.component.scss'],
  standalone: false,
})
export class SettingsMenuComponent {
  // (the footer's gear opens it: [matMenuTriggerFor]="settings.menu")
  @ViewChild(MatMenu, { static: true }) menu!: MatMenu;

  @Input({ required: true }) position!: SkillPosition;

  readonly sport = SPORT;
  readonly statBasisLabels = STAT_BASIS_LABELS;
  readonly settingsAt = settingsAt;

  // The Stat Totals setting's hover text, in the sport's terms
  readonly statBasisTitle =
    `Click to switch how counting stats (${SPORT.statBasisHelp.examples}) are shown and ranked: season totals, ` +
    `per game (fairer to anyone who missed time), or a full season's pace (${SPORT.statBasisHelp.pace})`;

  readonly rookiesTitle =
    `On: list only players in their first season (and first-year head coaches), across every tab but the team ones. ` +
    `A first season is the first one they're in our data, so ${SPORT.seasonText(SPORT.firstSeason)} lists everyone`;

  // The Display section's switches, in order (the sport's own in their slots)
  readonly switches: MenuSwitch[] = [
    this.switch('categoryColors', 'Category Dividers', `${SPORT.copy.groupLine} before each stat group in the rows, in the same color as its filter card`),
    this.switch(
      'colorValues',
      'Color-Coded Values',
      'Tint each value green above the list average and red below it, stronger the further out (flipped for lower-is-better stats like ' +
        `${SPORT.copy.lowerIsBetterExample})`,
    ),
    ...(SPORT.combined ? [this.switch('combineStats', SPORT.combined.label, SPORT.combined.title)] : []),
    ...settingsAt('display').map((setting) => this.sportSwitch(setting)),
    this.switch('showInjured', 'Injured Players', SPORT.copy.injuredHelp),
    this.switch('rookiesOnly', 'Rookies Only', this.rookiesTitle),
    this.switch(
      'showUnused',
      'Unweighted Stats',
      "Show columns for stats whose slider is at 0% (they still don't count in the ranking). Stats switched off with their eye stay hidden",
    ),
    ...settingsAt('displayEnd').map((setting) => this.sportSwitch(setting)),
  ];

  constructor(private positionService: PositionService) {}

  private switch(key: 'categoryColors' | 'colorValues' | 'combineStats' | 'showInjured' | 'rookiesOnly' | 'showUnused', label: string, title: string): MenuSwitch {
    return { label, title, on: () => this.settings[key], flip: () => this.set({ [key]: !this.settings[key] }) };
  }

  private sportSwitch(setting: SportSetting): MenuSwitch {
    return {
      label: setting.label,
      title: setting.title,
      on: () => !!this.settings.sport[setting.key],
      flip: () => this.stepSportSetting(setting.key),
    };
  }

  get settings(): RankerSettings {
    return this.positionService.settings;
  }

  private set(changes: Partial<RankerSettings>): void {
    this.positionService.updateSettings(changes);
  }

  cycleStatBasis(): void {
    this.positionService.cycleStatBasis();
  }

  // The sport's own settings: a choice cycles through its options, a switch flips
  stepSportSetting(key: string): void {
    this.positionService.stepSportSetting(key);
  }

  settingText(setting: SportSetting): string {
    return settingText(setting, this.settings.sport);
  }

  // Min Games (engine/playing-time): the stepper reads the share (1 when it's everyone), or the
  // sport's fixed count
  private get total(): number {
    return seasonLength(SKILL_UNITS, this.position);
  }

  get minCount(): number {
    return minCount(this.settings, this.total);
  }

  get minLabel(): string {
    if (SPORT.playingTime.fixed) return `${this.minCount}`;
    return this.settings.minShare ? `${Math.round(this.settings.minShare)}%` : '1';
  }

  get canLowerMin(): boolean {
    return SPORT.playingTime.fixed ? this.minCount > 1 : this.settings.minShare > 0;
  }

  get canRaiseMin(): boolean {
    return SPORT.playingTime.fixed ? this.minCount < this.total : this.settings.minShare < 100;
  }

  stepMin(step: number): void {
    const next = steppedMin(this.settings, this.total, step);
    if (next) this.set(next);
  }
}
