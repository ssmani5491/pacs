import { Module } from '@nestjs/common';
import { WorklistService } from './worklist.service';
import { WorklistController } from './worklist.controller';

@Module({ controllers: [WorklistController], providers: [WorklistService] })
export class WorklistModule {}
