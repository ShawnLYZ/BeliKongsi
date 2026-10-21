import { defineConfig } from 'prisma/config';

// Prisma 7 no longer loads .env files. Node's loadEnvFile never overrides variables that are
// already set, so real environment variables win over .env.local, which wins over .env.
for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    // The file is optional.
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Prisma's env() helper throws when the variable is missing, which would break
    // `prisma generate` in CI where no variables are set.
    url: process.env.MIGRATION_DATABASE_URL ?? '',
  },
});
