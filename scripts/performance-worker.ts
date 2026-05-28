import fs from 'fs/promises';
import path from 'path';

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function processJob(jobPath: string) {
  try {
    const raw = await fs.readFile(jobPath, 'utf-8');
    const job = JSON.parse(raw) as {
      cacheKey: string;
      startStr: string;
      endStr: string;
      benchesKey: string;
      periodStart: string;
      periodEnd: string;
      options?: { accountIds?: string[]; benchmarkSymbols?: string[] };
    };

    console.log('Processing performance job', job.cacheKey);
    const perf = await import('../src/lib/performance');
    const cache = await import('../src/lib/performance-cache');

    const periodStart = new Date(job.periodStart);
    const periodEnd = new Date(job.periodEnd);

    try {
      const result = await perf.getPerformance(periodStart, periodEnd, job.options);
      await cache.setCachedPerformance(job.cacheKey, job.startStr, job.endStr, job.benchesKey, result);
      console.log('Job completed', job.cacheKey);
    } catch (e) {
      console.error('Job failed', job.cacheKey, e);
    }

    await fs.unlink(jobPath);
  } catch (e) {
    console.error('Failed to process job', jobPath, e);
    try {
      // avoid tight loop on a bad file
      await fs.unlink(jobPath);
    } catch {}
  }
}

async function main() {
  const jobsDir = path.join(process.cwd(), 'performance-jobs');
  console.log('Performance worker started, watching', jobsDir);
  while (true) {
    try {
      await fs.mkdir(jobsDir, { recursive: true });
      const files = await fs.readdir(jobsDir);
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const full = path.join(jobsDir, f);
        await processJob(full);
      }
    } catch (e) {
      console.error('Worker loop error', e);
    }
    await sleep(5000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
