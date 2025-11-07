import { LetterGradePipe } from './letter-grade.pipe';

describe('LetterGradePipe', () => {
  it('create an instance', () => {
    const pipe = new LetterGradePipe();
    expect(pipe).toBeTruthy();
  });
});
