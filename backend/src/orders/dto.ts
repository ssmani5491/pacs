import {
  IsString, IsOptional, IsNotEmpty, MaxLength, IsUUID, IsIn, IsDateString,
} from 'class-validator';

export class CreateOrderDto {
  @IsUUID() patientId!: string;
  @IsString() @IsNotEmpty() @MaxLength(16) modalityType!: string;
  @IsString() @IsNotEmpty() @MaxLength(300) procedureDesc!: string;
  @IsOptional() @IsString() @MaxLength(300) studyDescription?: string;
  @IsOptional() @IsString() @MaxLength(2000) clinicalHistory?: string;
  @IsOptional() @IsIn(['ROUTINE', 'URGENT', 'STAT']) priority?: string;
  @IsOptional() @IsUUID() referringDoctorId?: string;
  @IsOptional() @IsUUID() assignedUserId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() organizationId?: string;
  @IsDateString() scheduledAt!: string;
}

export class UpdateOrderDto {
  @IsOptional() @IsString() @MaxLength(16) modalityType?: string;
  @IsOptional() @IsString() @MaxLength(300) procedureDesc?: string;
  @IsOptional() @IsString() @MaxLength(300) studyDescription?: string;
  @IsOptional() @IsString() @MaxLength(2000) clinicalHistory?: string;
  @IsOptional() @IsIn(['ROUTINE', 'URGENT', 'STAT']) priority?: string;
  @IsOptional() @IsUUID() referringDoctorId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsDateString() scheduledAt?: string;
}

export class AssignDto {
  @IsUUID() assignedUserId!: string;
}
