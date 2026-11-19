import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  // helmet: keep default protections but allow the OHIF viewer (same-origin) to
  // embed/stream DICOMweb. crossOriginResourcePolicy must permit same-site reads.
  // HSTS (Phase 9 SEC-3): disabled on plain HTTP dev; only meaningful over HTTPS,
  // and the brief forbids HSTS in local HTTP mode. Enable via HSTS_ENABLED=true
  // once TLS is terminated (see nginx/nginx-tls.conf.example).
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: (process.env.HSTS_ENABLED ?? 'false') === 'true'
        ? { maxAge: 15552000, includeSubDomains: true }
        : false,
    }),
  );
  app.use(cookieParser());
  // CORS (Phase 9 SEC-2): the SPA + API are served from the SAME nginx origin, so
  // the API does not need to reflect arbitrary origins. Restrict to a configurable
  // allow-list (defaults to common localhost origins). Requests with no Origin
  // header (same-origin, curl, server-to-server) are allowed. This closes the
  // previous "reflect any origin + credentials" misconfiguration.
  const allowedOrigins = (process.env.CORS_ORIGINS ??
    'http://localhost,http://localhost:80,http://127.0.0.1')
    .split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false); // not allowed: CORS headers omitted, browser blocks
    },
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

  const port = Number(process.env.BACKEND_PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`RIS+PACS backend listening on :${port}/api`);
}
bootstrap();
