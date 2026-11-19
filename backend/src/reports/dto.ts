import { IsString, IsOptional, IsUUID, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateReportDto {
  @IsUUID() studyId!: string;
  @IsOptional() @IsUUID() templateId?: string;
}

export class UpdateReportDto {
  @IsOptional() @IsString() @MaxLength(5000) clinicalHistory?: string;
  @IsOptional() @IsString() @MaxLength(5000) technique?: string;
  @IsOptional() @IsString() @MaxLength(5000) comparison?: string;
  @IsOptional() @IsString() @MaxLength(20000) findings?: string;
  @IsOptional() @IsString() @MaxLength(10000) impression?: string;
  @IsOptional() @IsString() @MaxLength(10000) recommendations?: string;
  @IsOptional() @IsUUID() templateId?: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class SignReportDto {
  // Step-up re-authentication password (never logged).
  @IsString() @IsNotEmpty() password!: string;
}

export class AddendumDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsOptional() @IsString() @MaxLength(20000) findings?: string;
  @IsOptional() @IsString() @MaxLength(10000) impression?: string;
  @IsOptional() @IsString() @MaxLength(10000) recommendations?: string;
}
