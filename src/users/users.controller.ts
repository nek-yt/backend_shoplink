import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiNotFoundResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Admin } from '../auth/auth.guard';
import { LOGIN_METHODS, MAX_ID, ROLES, SOURCES } from '../common/constants';
import { ParseIdPipe, type Query as QueryParams, queryEnum, queryNumber, queryPage, queryString } from '../common/query';
import {
  AdminUserDetailResponse,
  AdminUserPageResponse,
  ErrorResponse,
  LoginPageResponse,
  LoginResponse,
  UserStatsResponse,
} from '../common/responses';
import { USER_SORTS, UsersService } from './users.service';

@ApiTags('Users (admin)')
@ApiBadRequestResponse({ type: ErrorResponse, description: 'Invalid query' })
@Admin()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('stats')
  @ApiOperation({
    summary: 'How many people registered and logged in',
    description: 'Totals, today / last 7 days / last 30 days, and one row per day for charts.',
  })
  @ApiQuery({ name: 'days', required: false, type: Number, example: 30, description: 'Length of `daily`, 1 to 365' })
  stats(@Query() q: QueryParams): Promise<UserStatsResponse> {
    return this.users.stats(queryNumber(q, 'days', { min: 1, max: 365, integer: true }) ?? 30);
  }

  @Get('logins')
  @ApiOperation({ summary: 'Login history', description: 'Every successful register and login, newest first.' })
  @ApiQuery({ name: 'userId', required: false, type: Number })
  @ApiQuery({ name: 'method', required: false, enum: LOGIN_METHODS })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: '1 to 100' })
  logins(@Query() q: QueryParams): Promise<LoginPageResponse> {
    return this.users.logins({
      userId: queryNumber(q, 'userId', { min: 1, max: MAX_ID, integer: true }),
      method: queryEnum(q, 'method', LOGIN_METHODS),
      ...queryPage(q),
    });
  }

  @Get('logins/:id')
  @ApiOperation({ summary: 'One login record' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  login(@Param('id', ParseIdPipe) id: number): Promise<LoginResponse> {
    return this.users.login(id);
  }

  @Get()
  @ApiOperation({ summary: 'List users', description: 'With their last login, number of logins and number of orders.' })
  @ApiQuery({ name: 'search', required: false, description: 'Name, email, phone or social username' })
  @ApiQuery({ name: 'source', required: false, enum: SOURCES })
  @ApiQuery({ name: 'role', required: false, enum: ROLES })
  @ApiQuery({ name: 'sort', required: false, enum: USER_SORTS })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: '1 to 100' })
  list(@Query() q: QueryParams): Promise<AdminUserPageResponse> {
    return this.users.list({
      search: queryString(q, 'search'),
      source: queryEnum(q, 'source', SOURCES),
      role: queryEnum(q, 'role', ROLES),
      sort: queryEnum(q, 'sort', USER_SORTS) ?? 'newest',
      ...queryPage(q),
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'One user, with their last 20 logins' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  get(@Param('id', ParseIdPipe) id: number): Promise<AdminUserDetailResponse> {
    return this.users.get(id);
  }
}
