#!/usr/bin/env node

const DEFAULT_BASE_URL = "http://127.0.0.1:3001";
const DEFAULT_RUNS = 3;
const DEFAULT_TIMEOUT_MS = 240000;
const DEFAULT_PLATFORMS = ["ameba", "note", "hatena"];

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    runs: DEFAULT_RUNS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    startDate: formatDate(new Date()),
    platforms: [...DEFAULT_PLATFORMS],
  };

  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item === "--base-url") args.baseUrl = argv[++i] || args.baseUrl;
    if (item === "--runs") args.runs = Number(argv[++i]) || args.runs;
    if (item === "--timeout-ms") args.timeoutMs = Number(argv[++i]) || args.timeoutMs;
    if (item === "--start-date") args.startDate = argv[++i] || args.startDate;
    if (item === "--platforms") {
      const raw = argv[++i] || "";
      const candidates = raw
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      if (candidates.length > 0) args.platforms = candidates;
    }
  }

  return args;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(dateStr, offsetDays) {
  const [y, m, d] = dateStr.split("-").map((n) => Number(n));
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + offsetDays);
  return formatDate(dt);
}

function extractUrls(text = "") {
  const matches = text.match(/https?:\/\/[^\s)）]+/g) || [];
  return matches.map((url) => url.replace(/[、。！？,.]+$/g, ""));
}

function validateGeneratedPayload(payload, expectedPlatform) {
  const reasons = [];
  const complianceReport = payload?.complianceReport;

  if (!payload || typeof payload !== "object") {
    return ["response payload is not an object"];
  }

  if (!complianceReport || typeof complianceReport !== "object") {
    reasons.push("missing complianceReport");
  } else {
    if (complianceReport.platform !== expectedPlatform) {
      reasons.push(
        `complianceReport.platform mismatch (expected ${expectedPlatform}, got ${complianceReport.platform})`
      );
    }
    if (complianceReport.passed !== true) {
      reasons.push("complianceReport.passed is not true");
    }
    if (complianceReport.linkCount !== 1) {
      reasons.push(`complianceReport.linkCount expected 1, got ${complianceReport.linkCount}`);
    }
    if (!String(complianceReport.trackedUrl || "").includes(`utm_source=${expectedPlatform}`)) {
      reasons.push("trackedUrl missing utm_source");
    }
  }

  const title = String(payload.title || "");
  const imagePrompt = String(payload.imagePrompt || "");
  const body = String(payload.body || "");
  const takkenaiLink = String(payload.takkenaiLink || "");

  if (/https?:\/\//i.test(title)) {
    reasons.push("title contains URL");
  }
  if (/https?:\/\//i.test(imagePrompt)) {
    reasons.push("imagePrompt contains URL");
  }

  const bodyUrls = extractUrls(body);
  if (bodyUrls.length !== 1) {
    reasons.push(`body URL count expected 1, got ${bodyUrls.length}`);
  }
  if (!takkenaiLink.includes("takkenai.jp")) {
    reasons.push("takkenaiLink is not takkenai.jp");
  }
  if (!takkenaiLink.includes(`utm_source=${expectedPlatform}`)) {
    reasons.push("takkenaiLink missing utm_source");
  }

  return reasons;
}

async function postGenerate({ baseUrl, date, platform, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({ date, platform }),
    });

    const payload = await res
      .json()
      .catch(async () => ({ raw: await res.text().catch(() => "") }));

    return { ok: res.ok, status: res.status, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const platforms = args.platforms.filter((platform) =>
    DEFAULT_PLATFORMS.includes(platform)
  );

  if (platforms.length === 0) {
    console.error(
      `No valid platforms selected. Use --platforms with: ${DEFAULT_PLATFORMS.join(",")}`
    );
    process.exit(1);
  }

  const summary = [];
  const failures = [];

  console.log("=== Generate Compliance Check ===");
  console.log(
    JSON.stringify(
      {
        baseUrl: args.baseUrl,
        runs: args.runs,
        startDate: args.startDate,
        platforms,
        timeoutMs: args.timeoutMs,
      },
      null,
      2
    )
  );

  for (const platform of platforms) {
    for (let i = 0; i < args.runs; i++) {
      const date = addDays(args.startDate, i);
      const id = `${platform}#${i + 1}(${date})`;
      process.stdout.write(`\n[RUN] ${id} ... `);

      try {
        const result = await postGenerate({
          baseUrl: args.baseUrl,
          date,
          platform,
          timeoutMs: args.timeoutMs,
        });

        if (!result.ok) {
          const reason =
            result?.payload?.error ||
            result?.payload?.message ||
            `HTTP ${result.status}`;
          console.log("FAIL");
          failures.push({ id, reason });
          continue;
        }

        const reasons = validateGeneratedPayload(result.payload, platform);
        if (reasons.length > 0) {
          console.log("FAIL");
          failures.push({ id, reason: reasons.join(" | ") });
          continue;
        }

        const trackedUrl = result.payload?.complianceReport?.trackedUrl || "";
        console.log("PASS");
        summary.push({
          id,
          title: String(result.payload?.title || "").slice(0, 60),
          trackedUrl,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.log("FAIL");
        failures.push({ id, reason });
      }
    }
  }

  console.log("\n=== PASS SUMMARY ===");
  if (summary.length === 0) {
    console.log("(none)");
  } else {
    for (const item of summary) {
      console.log(`- ${item.id}: ${item.title}`);
      console.log(`  ${item.trackedUrl}`);
    }
  }

  console.log("\n=== FAILURES ===");
  if (failures.length === 0) {
    console.log("(none)");
    console.log("\nAll runs passed compliance checks.");
    return;
  }

  for (const item of failures) {
    console.log(`- ${item.id}: ${item.reason}`);
  }

  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
