import { IsString, IsOptional, IsBoolean, IsUUID, IsNotEmpty, MaxLength } from 'class-validator';
import { PaginationQuery } from '../common/pagination';

export class TemplateQuery extends PaginationQuery {
  @IsOptional() @IsString() modality?: string;
  @IsOptional() @IsString() active?: string;
}

export class CreateTemplateDto {
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(32) code?: string;
  @IsOptional() @IsString() @MaxLength(16) modalityType?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsString() @MaxLength(5000) technique?: string;
  @IsOptional() @IsString() @MaxLength(20000) bodyFindings?: string;
  @IsOptional() @IsString() @MaxLength(10000) bodyImpression?: string;
  @IsOptional() @IsString() @MaxLength(10000) bodyRecommendations?: string;
  @IsOptional() @IsString() @MaxLength(5000) defaultText?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateTemplateDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(32) code?: string;
  @IsOptional() @IsString() @MaxLength(16) modalityType?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsString() @MaxLength(5000) technique?: string;
  @IsOptional() @IsString() @MaxLength(20000) bodyFindings?: string;
  @IsOptional() @IsString() @MaxLength(10000) bodyImpression?: string;
  @IsOptional() @IsString() @MaxLength(10000) bodyRecommendations?: string;
  @IsOptional() @IsString() @MaxLength(5000) defaultText?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class SetActiveDto {
  @IsBoolean() active!: boolean;
}
