import { IsString, IsOptional, IsBoolean, IsNotEmpty, MaxLength, IsInt, Min, Max, IsUUID } from 'class-validator';

// NOTE: field set is standard DICOM — pending the New Modality screenshot for
// exact Pixray fields. Additive changes won't break the API.
export class CreateModalityDto {
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(16) aeTitle!: string;   // DICOM AE title (<=16 chars)
  @IsString() @IsNotEmpty() @MaxLength(255) host!: string;
  @IsInt() @Min(1) @Max(65535) port!: number;
  @IsString() @IsNotEmpty() @MaxLength(16) modalityType!: string; // CT, MR, CR, DX, US...
}

export class UpdateModalityDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(16) aeTitle?: string;
  @IsOptional() @IsString() @MaxLength(255) host?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsString() @MaxLength(16) modalityType?: string;
  @IsOptional() @IsUUID() departmentId?: string;
}

export class SetActiveDto {
  @IsBoolean() active!: boolean;
}
