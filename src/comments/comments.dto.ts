import { Check, rules } from '../common/validation';

export class CommentDto {
  /** 1 to 1000 characters. @example Does it run small? I usually wear M. */
  @Check(rules.text({ min: 1, max: 1000 }))
  text: string;
}
