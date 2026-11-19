import {
  IsString, IsOptional, IsBoolean, IsNotEmpty, MaxLength, IsEmail, IsUUID,
  MinLength, IsArray,
} from 'class-validator';

// NOTE: field set is standard/flexible — pending the Admin→User screenshot for
// exact Pixray fields and the real role list. Extra fields can be added without
// breaking the API (additive).
export class CreateUserDto {
  @IsString() @IsNotEmpty() @MaxLength(64) username!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) fullName!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsOptional() @IsString() @MaxLength(32) mobile?: string;
  @IsOptional() @IsString() @MaxLength(64) employeeId?: string;
  @IsOptional() @IsString() @MaxLength(100) designation?: string;
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) roleKeys?: string[];
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MaxLength(200) fullName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(32) mobile?: string;
  @IsOptional() @IsString() @MaxLength(64) employeeId?: string;
  @IsOptional() @IsString() @MaxLength(100) designation?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) roleKeys?: string[];
}

export class SetActiveDto {
  @IsBoolean() active!: boolean;
}

export class ResetPasswordDto {
  @IsString() @MinLength(8) newPassword!: string;
}
