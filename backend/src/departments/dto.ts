import { IsString, IsOptional, IsBoolean, IsNotEmpty, MaxLength, IsUUID } from 'class-validator';

export class CreateDepartmentDto {
  @IsUUID() organizationId!: string;
  @IsString() @IsNotEmpty() @MaxLength(32) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(100) jobType?: string;
}

export class UpdateDepartmentDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(100) jobType?: string;
}

export class SetActiveDto {
  @IsBoolean() active!: boolean;
}
