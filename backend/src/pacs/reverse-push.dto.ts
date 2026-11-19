import { IsString, IsOptional, IsInt, IsBoolean, IsUUID, IsNotEmpty, MaxLength, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateDestinationDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(16) aeTitle!: string;
  @IsString() @IsNotEmpty() @MaxLength(255) host!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(65535) port!: number;
  @IsOptional() @IsString() @MaxLength(16) callingAet?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(300) connectionTimeout?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(600) associationTimeout?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(16) maxConcurrent?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class UpdateDestinationDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(16) aeTitle?: string;
  @IsOptional() @IsString() @MaxLength(255) host?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsString() @MaxLength(16) callingAet?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(300) connectionTimeout?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(600) associationTimeout?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(16) maxConcurrent?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class CreateTransferJobDto {
  @IsUUID() destinationId!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) studyInstanceUid!: string;
}
