#!/usr/bin/env node

const baseUrl = (process.env.CHECK_SITE_URL || "https://takkenai.jp").replace(
  /\/+$/,
  ""
);

function normalizePath(input) {
  if (!input) return "/";
  if (input.startsWith("/")) return input;
  return `/${input}`;
}

function parseRobots(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean);

  const groups = [];
  let current = { agents: [], disallow: [], allow: [] };

  const pushCurrent = () => {
    if (current.agents.length > 0) {
      groups.push(current);
    }
    current = { agents: [], disallow: [], allow: [] };
  };

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith("user-agent:")) {
      const value = line.slice("user-agent:".length).trim().toLowerCase();
      if (current.disallow.length > 0 || current.allow.length > 0) {
        pushCurrent();
      }
      current.agents.push(value);
      continue;
    }
    if (lower.startsWith("disallow:")) {
      current.disallow.push(normalizePath(line.slice("disallow:".length).trim()));
      continue;
    }
    if (lower.startsWith("allow:")) {
      current.allow.push(normalizePath(line.slice("allow:".length).trim()));
    }
  }
  pushCurrent();
  return groups;
}

function resolveGroup(groups, agent) {
  const exact = groups.find((group) => group.agents.includes(agent));
  if (exact) return exact;
  return groups.find((group) => group.agents.includes("*")) || null;
}

function isBlocked(group, path) {
  if (!group) return false;
  const target = normalizePath(path);
  let blocked = false;
  let longestDisallow = -1;
  for (const rule of group.disallow) {
    if (!rule || rule === "") continue;
    if (target.startsWith(rule) && rule.length > longestDisallow) {
      longestDisallow = rule.length;
      blocked = true;
    }
  }
  let longestAllow = -1;
  for (const rule of group.allow) {
    if (!rule || rule === "") continue;
    if (target.startsWith(rule) && rule.length > longestAllow) {
      longestAllow = rule.length;
    }
  }
  if (longestAllow >= longestDisallow) {
    return false;
  }
  return blocked;
}

async function fetchText(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "takkenai-search-readiness-check/1.0",
    },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

function hasMetaDescription(html) {
  return /<meta[^>]+name=["']description["'][^>]*content=["'][^"']+["'][^>]*>/i.test(
    html
  );
}

function hasTitle(html) {
  return /<title>\s*[^<]{4,}\s*<\/title>/i.test(html);
}

async function main() {
  const warnings = [];
  const infos = [];

  try {
    const robotsUrl = `${baseUrl}/robots.txt`;
    const robotsRes = await fetchText(robotsUrl);
    if (!robotsRes.ok) {
      warnings.push(`robots.txt 不可访问: ${robotsRes.status} (${robotsUrl})`);
    } else {
      infos.push(`robots.txt 可访问: ${robotsUrl}`);
      const groups = parseRobots(robotsRes.text);
      const searchBotGroup = resolveGroup(groups, "oai-searchbot");
      const chatgptUserGroup = resolveGroup(groups, "chatgpt-user");

      if (isBlocked(searchBotGroup, "/")) {
        warnings.push("OAI-SearchBot 在 robots.txt 中被 Disallow / 阻止");
      } else {
        infos.push("OAI-SearchBot 对首页可抓取");
      }

      if (isBlocked(chatgptUserGroup, "/")) {
        warnings.push("ChatGPT-User 在 robots.txt 中被 Disallow / 阻止");
      } else {
        infos.push("ChatGPT-User 对首页可访问");
      }
    }
  } catch (error) {
    warnings.push(
      `robots.txt 检查失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const samplePages = ["/", "/tools/loan/"];
  for (const path of samplePages) {
    const url = `${baseUrl}${path}`;
    try {
      const pageRes = await fetchText(url);
      if (!pageRes.ok) {
        warnings.push(`页面不可访问: ${url} (${pageRes.status})`);
        continue;
      }
      if (!hasTitle(pageRes.text)) {
        warnings.push(`页面缺少有效 <title>: ${url}`);
      }
      if (!hasMetaDescription(pageRes.text)) {
        warnings.push(`页面缺少 meta description: ${url}`);
      }
      infos.push(`页面可访问: ${url}`);
    } catch (error) {
      warnings.push(
        `页面检查失败: ${url} (${error instanceof Error ? error.message : String(error)})`
      );
    }
  }

  console.log(`[check-openai-search-readiness] site=${baseUrl}`);
  for (const line of infos) {
    console.log(`INFO: ${line}`);
  }
  if (warnings.length === 0) {
    console.log("PASS: 未发现阻断性问题");
  } else {
    console.log("WARN: 发现潜在问题");
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  }
}

main().catch((error) => {
  console.error(
    `[check-openai-search-readiness] failed: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exit(1);
});
