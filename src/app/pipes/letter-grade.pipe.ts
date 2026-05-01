import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
    name: 'letterGrade',
    standalone: false
})
export class LetterGradePipe implements PipeTransform {
  transform(value: number): string {
    if (value < 0 || value > 12) {
      return 'Invalid Grade';
    }

    const grades = [
      'F',
      'D-',
      'D',
      'D+',
      'C-',
      'C',
      'C+',
      'B-',
      'B',
      'B+',
      'A-',
      'A',
      'A+',
    ];

    return grades[value];
  }
}
