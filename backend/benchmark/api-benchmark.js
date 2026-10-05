import autocannon from "autocannon";

const URL = "http://localhost:4000/api/health";

const CONCURRENCY_LEVELS = [1, 10, 50, 100, 150, 200];
const DURATION_SECONDS = 10;

function getPercentile(latency, percentile) {
  const value = latency?.[percentile];

  return typeof value === "number" ? value : 0;
}

async function runBenchmark(connections) {
  console.log(
    `\nRunning: ${connections} concurrent connection(s) for ${DURATION_SECONDS}s...`
  );

  return new Promise((resolve, reject) => {
    autocannon(
      {
        url: URL,
        connections,
        duration: DURATION_SECONDS,
        pipelining: 1,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({
          concurrency: connections,

          requestsPerSecond:
            typeof result.requests?.average === "number"
              ? result.requests.average
              : 0,

          totalRequests:
            typeof result.requests?.total === "number"
              ? result.requests.total
              : 0,

          averageLatency:
            typeof result.latency?.average === "number"
              ? result.latency.average
              : 0,

          p50: getPercentile(result.latency, "p50"),

          p95:
            result.latency?.p97_5 ??
            result.latency?.p95 ??
            result.latency?.["97.5th"] ??
            0,

          p99:
            result.latency?.p99 ??
            result.latency?.["99th"] ??
            result.latency?.["99"] ??
            0,

          errors: result.errors ?? 0,

          timeouts: result.timeouts ?? 0,
        });
      }
    );
  });
}

async function main() {
  console.log("==========================================");
  console.log("      TaxMate API Performance Benchmark");
  console.log("==========================================");
  console.log(`Target: ${URL}`);
  console.log(`Duration: ${DURATION_SECONDS}s per test`);
  console.log(`Concurrency: ${CONCURRENCY_LEVELS.join(", ")}`);
  console.log("==========================================");

  const results = [];

  for (const connections of CONCURRENCY_LEVELS) {
    try {
      const result = await runBenchmark(connections);
      results.push(result);
    } catch (error) {
      console.error(
        `Benchmark failed at ${connections} connections:`,
        error.message
      );
    }
  }

  console.log("\n==========================================");
  console.log("              RESULTS");
  console.log("==========================================\n");

  console.table(
    results.map((result) => ({
      Concurrent: result.concurrency,

      "Req/sec": Number(result.requestsPerSecond.toFixed(2)),

      "Total Requests": result.totalRequests,

      "Avg Latency": `${result.averageLatency.toFixed(2)} ms`,

      P50: `${result.p50.toFixed(2)} ms`,

      P95: `${result.p95.toFixed(2)} ms`,

      P99: `${result.p99.toFixed(2)} ms`,

      Errors: result.errors,

      Timeouts: result.timeouts,
    }))
  );

  console.log("\nBenchmark complete.");
}

main();