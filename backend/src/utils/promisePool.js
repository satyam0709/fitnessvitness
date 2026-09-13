/** Run async thunks with a cap so Prisma stays under the MySQL connection limit. */
async function promisePool(fns, concurrency = 3) {
  const tasks = Array.isArray(fns) ? fns : [];
  if (tasks.length === 0) return [];
  const limit = Math.max(1, Number(concurrency) || 3);
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= tasks.length) return;
      const fn = tasks[i];
      results[i] = typeof fn === "function" ? await fn() : await fn;
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

module.exports = { promisePool };
