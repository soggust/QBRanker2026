import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'formatRecentGames',
})
export class FormatRecentGamesPipe implements PipeTransform {
  transform(value: number): string {
    return value === 1 ? 'W' : 'L';
  }
}
