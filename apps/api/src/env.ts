// Must be imported before anything that creates a PrismaClient.
// Vercel's Postgres integration names the connection string differently, so accept its names as well.
export const databaseUrlSource = process.env.DATABASE_URL
  ? 'DATABASE_URL'
  : (['POSTGRES_DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_DATABASE_URL'] as const).find((k) => process.env[k]);

if (!process.env.DATABASE_URL && databaseUrlSource) process.env.DATABASE_URL = process.env[databaseUrlSource];
