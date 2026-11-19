import { IsOptional, IsString, IsIn, IsDateString, IsUUID } from 'class-validator';
import { PaginationQuery } from '../common/pagination';

// Worklist query extends pagination with RIS filters.
export class WorklistQuery extends PaginationQuery {
  @IsOptional() @IsIn(['ALL', 'READY', 'DRAFT', 'PRELIMINARY', 'FINAL', 'CANCELLED', 'PENDING'])
  status?: string;

  @IsOptional() @IsString() patientId?: string;   // MRN
  @IsOptional() @IsString() patientName?: string;
  @IsOptional() @IsString() accession?: string;
  @IsOptional() @IsString() modality?: string;     // comma-separated list allowed
  @IsOptional() @IsDateString() dateFrom?: string;
  @IsOptional() @IsDateString() dateTo?: string;
  @IsOptional() @IsUUID() referringDoctorId?: string;
  @IsOptional() @IsString() reportContent?: string;
  @IsOptional() @IsUUID() assignedUserId?: string;
  @IsOptional() @IsString() myAssignment?: string; // 'true'
}

export class AssignStudyDto {
  @IsUUID() userId!: string;
}
