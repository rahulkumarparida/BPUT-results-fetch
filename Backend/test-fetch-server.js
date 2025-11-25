// test-fetch-server.js
// Run this from the backend folder: node test-fetch-server.js
// Verifies the harvester server fetches real results for one roll.

const fs = require("fs");
const path = require("path");

const API_BASE = "http://localhost:4000";
const TEST_ROLL = "2301230095"; // change to any known roll
const SEMID = "4";
const SESSION = "Even-(2024-25)";

// Polling/timeouts
const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

async function wait(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function startJob() {
  const body = {
    startRoll: TEST_ROLL,
    endRoll: TEST_ROLL,
    semid: SEMID,
    session: SESSION,
    config: {
      concurrency: 1,
      perReqAttempts: 3,
      perReqTimeout: 15000,
      interRequestDelay: 300,
      cycleBackoffBase: 2000,
      maxCycleBackoff: 60000,
      maxCycles: 0
    }
  };

  console.log("Starting job for roll", TEST_ROLL);
  const resp = await fetch(`${API_BASE}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Start failed: ${resp.status} ${txt}`);
  }
  const j = await resp.json();
  console.log("Job started:", j);
  return j.jobId;
}

async function pollStatus(jobId, timeoutMs = TIMEOUT_MS) {
  const start = Date.now();
  while (true) {
    const resp = await fetch(`${API_BASE}/status/${jobId}`);
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`Status fetch failed: ${resp.status} ${t}`);
    }
    const j = await resp.json();
    console.log(`[status] state=${j.state}, done=${j.done}/${j.total}, percent=${j.percent}, cycle=${j.cycle}`);
    if (j.state === "finished") return j;
    if (j.state === "error") throw new Error(`Job error: ${JSON.stringify(j)}`);
    if (Date.now() - start > timeoutMs) throw new Error("Timeout waiting for job to finish");
    await wait(POLL_INTERVAL_MS);
  }
}

async function downloadCsv(jobId, outDir = "./test-output") {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const url = `${API_BASE}/download/${jobId}?type=csv`;
  console.log("Downloading CSV from", url);
  const resp = await fetch(url);
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Download failed: ${resp.status} ${t}`);
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  const outPath = path.join(outDir, `${jobId}.csv`);
  fs.writeFileSync(outPath, buffer);
  console.log("Saved CSV to", outPath);
  return outPath;
}

async function verifyCsvContainsRoll(csvPath, roll) {
  const content = fs.readFileSync(csvPath, "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length < 1) throw new Error("CSV appears empty");
  // naive check: csv contains the roll number somewhere
  if (!content.includes(roll)) {
    // show first few lines for debugging
    console.error("CSV sample:\n", lines.slice(0, 8).join("\n"));
    throw new Error(`CSV does not contain roll ${roll}`);
  }
  console.log(`CSV verification passed — contains roll ${roll}`);
}

(async () => {
  try {
    const jobId = await startJob();
    const status = await pollStatus(jobId);
    console.log("Job finished:", status);

    // download csv and check
    const csvPath = await downloadCsv(jobId);
    await verifyCsvContainsRoll(csvPath, TEST_ROLL);

    console.log("TEST SUCCESS: server fetched data correctly.");
    process.exit(0);
  } catch (err) {
    console.error("TEST FAILED:", err.message || err);
    process.exit(1);
  }
})();
