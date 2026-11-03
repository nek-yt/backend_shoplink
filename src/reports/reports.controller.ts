import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCreatedResponse, ApiNotFoundResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Admin, Auth, CurrentUser } from '../auth/auth.guard';
import { REPORT_STATUSES } from '../common/constants';
import { ParseIdPipe, type Query as QueryParams, queryEnum, queryPage } from '../common/query';
import { ErrorResponse } from '../common/responses';
import type { User } from '../generated/prisma/client';
import { CreateReportDto, UpdateReportDto } from './reports.dto';
import { ReportPageResponse, ReportReceivedResponse, ReportResponse, ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiBadRequestResponse({ type: ErrorResponse, description: 'Invalid input' })
@ApiNotFoundResponse({ type: ErrorResponse })
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @Auth()
  @ApiOperation({ summary: 'Report a product', description: 'Any logged-in user, not for your own products. Reporting it again replaces your reason.' })
  @ApiCreatedResponse({ type: ReportReceivedResponse })
  create(@CurrentUser() user: User, @Body() body: CreateReportDto): Promise<ReportReceivedResponse> {
    return this.reports.create(user, body.productId, body.reason, body.note);
  }

  @Get()
  @Admin()
  @ApiOperation({ summary: 'All reports (admin)', description: 'Newest first, with the product, its seller and the reporter.' })
  @ApiQuery({ name: 'status', required: false, enum: REPORT_STATUSES })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: '1 to 100' })
  list(@Query() q: QueryParams): Promise<ReportPageResponse> {
    const { page, limit } = queryPage(q);
    return this.reports.list(queryEnum(q, 'status', REPORT_STATUSES), page, limit);
  }

  @Patch(':id')
  @Admin()
  @ApiOperation({ summary: 'Mark a report resolved, dismissed or open (admin)' })
  update(@Param('id', ParseIdPipe) id: number, @Body() body: UpdateReportDto): Promise<ReportResponse> {
    return this.reports.update(id, body.status);
  }

  @Post('product/:productId')
  @Admin()
  @ApiOperation({ summary: 'Close all open reports on a product (admin)', description: 'For when you dealt with the product itself.' })
  resolveProduct(@Param('productId', ParseIdPipe) productId: number, @Body() body: UpdateReportDto): Promise<{ updated: number }> {
    return this.reports.resolveProduct(productId, body.status);
  }
}
