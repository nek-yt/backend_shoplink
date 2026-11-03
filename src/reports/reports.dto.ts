import { REPORT_REASONS, REPORT_STATUSES, type ReportReason, type ReportStatus } from '../common/constants';
import { Check, Optional, rules } from '../common/validation';

export class CreateReportDto {
  /** The product being reported. @example 12 */
  @Check(rules.integer({ min: 1 }))
  productId: number;

  /** @example fake */
  @Check(rules.oneOf(REPORT_REASONS))
  reason: ReportReason;

  /** What's wrong, in the reporter's words. Up to 1000 characters. @example The photos are from another shop. */
  @Optional()
  @Check(rules.text({ max: 1000 }))
  note: string = '';
}

export class UpdateReportDto {
  /** resolved: you acted on it; dismissed: nothing wrong; open: look again later. @example resolved */
  @Check(rules.oneOf(REPORT_STATUSES))
  status: ReportStatus;
}
