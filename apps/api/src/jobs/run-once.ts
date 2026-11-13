// Runs the reminder job once and exits. For a Windows Task Scheduler / cron entry when the API
// isn't kept running: `npm run jobs:run -w api`.
import '../env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { RemindersService } from '../notifications/reminders.service';

async function main() {
  process.env.JOBS_ENABLED = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const result = await app.get(RemindersService).run();
  console.log(result);
  await app.close();
}

void main();
