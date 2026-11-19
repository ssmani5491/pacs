import { IsOptional, IsString } from 'class-validator';
import { PaginationQuery } from '../common/pagination';

// Reception-logs query: pagination + optional status filter (whitelisted so the
// global ValidationPipe with forbidNonWhitelisted does not 400).
export class ReceptionLogQuery extends PaginationQuery {
  @IsOptional() @IsString() status?: string;
}
