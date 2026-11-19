import {
  IsString, IsOptional, IsNotEmpty, MaxLength, IsEmail, IsUUID,
  IsIn, IsDateString, IsBoolean,
} from 'class-validator';

export class CreatePatientDto {
  @IsOptional() @IsString() @MaxLength(64) mrn?: string; // auto-generated if omitted
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @IsOptional() @IsDateString() dob?: string;
  @IsOptional() @IsIn(['M', 'F', 'O', 'U']) gender?: string;
  @IsOptional() @IsString() @MaxLength(32) mobile?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsUUID() referringDoctorId?: string;
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsBoolean() allowDuplicate?: boolean; // override duplicate guard
}

export class UpdatePatientDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsDateString() dob?: string;
  @IsOptional() @IsIn(['M', 'F', 'O', 'U']) gender?: string;
  @IsOptional() @IsString() @MaxLength(32) mobile?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsUUID() referringDoctorId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
}

export class SetStatusDto {
  @IsIn(['ACTIVE', 'INACTIVE']) status!: string;
}

export class MergePatientDto {
  @IsUUID() targetId!: string; // keep this one
  @IsUUID() sourceId!: string; // merge+retire this one
}
