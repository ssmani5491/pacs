import { IsString, IsOptional, IsBoolean, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateOrgDto {
  @IsString() @IsNotEmpty() @MaxLength(32) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(200) contact?: string;
  @IsOptional() @IsString() logoRef?: string;
}

export class UpdateOrgDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(200) contact?: string;
  @IsOptional() @IsString() logoRef?: string;
}

export class SetActiveDto {
  @IsBoolean() active!: boolean;
}
