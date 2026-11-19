import { IsInt, IsOptional, IsString, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

/** Standard list query: ?page=1&pageSize=20&search=foo&sortBy=name&sortDir=asc */
export class PaginationQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize = 20;

  @IsOptional() @IsString()
  search?: string;

  @IsOptional() @IsString()
  sortBy?: string;

  @IsOptional() @IsIn(['asc', 'desc'])
  sortDir: 'asc' | 'desc' = 'asc';
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function paginate<T>(
  data: T[],
  total: number,
  q: PaginationQuery,
): Paginated<T> {
  return {
    data,
    total,
    page: q.page,
    pageSize: q.pageSize,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}

/** Build a safe Prisma orderBy from an allow-list of sortable columns. */
export function buildOrderBy(q: PaginationQuery, allowed: string[], fallback: string) {
  const col = q.sortBy && allowed.includes(q.sortBy) ? q.sortBy : fallback;
  return { [col]: q.sortDir };
}

export function skipTake(q: PaginationQuery) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}
