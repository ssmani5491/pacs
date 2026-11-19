import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'http';

export interface SupervisorProcessInfo {
  name: string;
  statename: string; // RUNNING | STOPPED | FATAL | STARTING | ...
  description: string;
  uptime: number;
}

/**
 * Reads process status from supervisord's XML-RPC API (getAllProcessInfo),
 * used ONLY inside the all-in-one image (deploy/allinone) — supervisord does
 * not run in the dev docker-compose.yml stack, so this always returns
 * { available: false } there, by design (no new service/dependency added to
 * the dev stack for this).
 *
 * Hand-rolled XML-RPC request (supervisord's API is one simple method call)
 * rather than adding an XML-RPC client dependency for a single call.
 */
@Injectable()
export class SupervisorService {
  constructor(private config: ConfigService) {}

  async getProcessStatus(): Promise<{ available: boolean; processes: SupervisorProcessInfo[] }> {
    const host = this.config.get<string>('SUPERVISOR_RPC_HOST') ?? '127.0.0.1';
    const port = Number(this.config.get<string>('SUPERVISOR_RPC_PORT') ?? '9001');
    const user = this.config.get<string>('SUPERVISOR_UI_USER');
    const pass = this.config.get<string>('SUPERVISOR_UI_PASSWORD');
    if (!user || !pass) return { available: false, processes: [] };

    const body =
      '<?xml version="1.0"?><methodCall><methodName>supervisor.getAllProcessInfo</methodName><params></params></methodCall>';
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');

    try {
      const xml = await new Promise<string>((resolve, reject) => {
        const req = http.request(
          { host, port, path: '/RPC2', method: 'POST', timeout: 3000,
            headers: { 'Content-Type': 'text/xml', 'Content-Length': Buffer.byteLength(body), Authorization: `Basic ${auth}` } },
          (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => resolve(data));
          },
        );
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('supervisor RPC timeout')));
        req.write(body);
        req.end();
      });
      return { available: true, processes: parseProcessInfoXml(xml) };
    } catch {
      return { available: false, processes: [] };
    }
  }
}

/** Minimal extraction of name/statename/description/uptime from supervisord's getAllProcessInfo response. */
function parseProcessInfoXml(xml: string): SupervisorProcessInfo[] {
  const structs = xml.match(/<struct>[\s\S]*?<\/struct>/g) ?? [];
  return structs.map((s) => ({
    name: extractMember(s, 'name') ?? 'unknown',
    statename: extractMember(s, 'statename') ?? 'UNKNOWN',
    description: extractMember(s, 'description') ?? '',
    uptime: Number(extractMember(s, 'uptime') ?? '0'),
  }));
}
function extractMember(struct: string, name: string): string | null {
  const re = new RegExp(`<name>${name}</name>\\s*<value>(?:<string>)?([^<]*)`, 'i');
  const m = struct.match(re);
  return m ? m[1] : null;
}
