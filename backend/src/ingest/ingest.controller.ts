import { Controller, Post, Body, Headers, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IngestService } from './ingest.service';
import { Public } from '../auth/public.decorator';

// Called by Orthanc's on-stored.lua (internal network only). Protected by a
// shared secret header so only Orthanc can trigger ingestion.
@Controller('ingest')
export class IngestController {
  private readonly log = new Logger('IngestController');
  constructor(private svc: IngestService, private config: ConfigService) {}

  @Public() // not a user JWT route; uses the ingest secret instead
  @Post('orthanc-study')
  async ingest(@Body() body: { studyId: string }, @Headers('x-ingest-secret') secret?: string) {
    const expected = this.config.get<string>('INGEST_SECRET');
    // If a secret is configured, require it. (Orthanc runs on the internal network.)
    if (expected && secret !== expected) throw new UnauthorizedException('Bad ingest secret');
    if (!body?.studyId) return { ok: false, error: 'studyId required' };
    const res = await this.svc.ingestOrthancStudy(body.studyId);
    return { ok: true, ...res };
  }
}
