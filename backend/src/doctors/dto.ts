import { IsString, IsOptional, IsBoolean, IsNotEmpty, MaxLength, IsUUID } from 'class-validator';

export class CreateDoctorDto {
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(200) qualification?: string;
  @IsOptional() @IsString() @MaxLength(200) specialization?: string;
  @IsOptional() @IsString() @MaxLength(100) registrationNo?: string;
  @IsOptional() @IsString() @MaxLength(200) contact?: string;
  @IsOptional() @IsBoolean() canReport?: boolean;
}

export class UpdateDoctorDto {
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(200) qualification?: string;
  @IsOptional() @IsString() @MaxLength(200) specialization?: string;
  @IsOptional() @IsString() @MaxLength(100) registrationNo?: string;
  @IsOptional() @IsString() @MaxLength(200) contact?: string;
  @IsOptional() @IsBoolean() canReport?: boolean;
}

export class SetActiveDto {
  @IsBoolean() active!: boolean;
}
