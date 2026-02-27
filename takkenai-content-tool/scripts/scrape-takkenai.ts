/**
 * Scrapes takkenai.jp sitemap to build topic database files.
 * Run with: npm run scrape
 */

interface KnowledgePoint {
  id: string;
  subject: string;
  title: string;
  slug: string;
  takkenaiUrl: string;
}

interface Tool {
  id: string;
  name: string;
  slug: string;
  category: string;
  takkenaiUrl: string;
}

interface PastQuestion {
  id: string;
  year: number;
  number: number;
  subject: string;
  takkenaiUrl: string;
}

async function fetchSitemapIndex(): Promise<string[]> {
  const res = await fetch("https://takkenai.jp/sitemap-index.xml");
  const text = await res.text();
  const urls: string[] = [];
  const regex = /<loc>(.*?)<\/loc>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

async function fetchSitemap(url: string): Promise<string[]> {
  try {
    const res = await fetch(url);
    const text = await res.text();
    const urls: string[] = [];
    const regex = /<loc>(.*?)<\/loc>/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      urls.push(match[1]);
    }
    return urls;
  } catch (e) {
    console.error(`Failed to fetch ${url}:`, e);
    return [];
  }
}

function categorizeSubject(path: string): string {
  if (path.includes("gyouhou") || path.includes("takken-gyouhou")) return "宅建業法";
  if (path.includes("minpou") || path.includes("kenri")) return "権利関係";
  if (path.includes("hourei") || path.includes("seigen")) return "法令上の制限";
  if (path.includes("zei") || path.includes("sonota") || path.includes("tax")) return "税・その他";
  return "その他";
}

function extractToolCategory(slug: string): string {
  const categories: Record<string, string[]> = {
    market: ["satei", "chika", "eki-souba", "chinryo", "kenpei", "kanrihi", "reform"],
    finance: ["loan", "shohiyo", "chukai", "inshi", "touroku", "kotei", "depreciation", "inheritance", "gift"],
    investment: ["toushi", "buy-vs-rent", "dcf", "leverage", "cap-rate", "investment-risk", "exit-strategy", "sublease"],
    marketing: ["sns", "video", "chirashi", "catchcopy", "content-marketing", "openhouse", "area-guide", "property-lp"],
    sales: ["bukken-hikaku", "shikin", "property-center", "market-report", "meishi"],
    customer: ["email", "kotowari", "testimonial", "faq"],
    operations: ["torihiki", "shorui", "hikiwatashi"],
    compliance: ["jusetsu", "hourei-search"],
    management: ["koshin", "taikyo", "shikikin", "rent-escalation", "rent-guarantee", "vacancy"],
    commercial: ["office", "tenant", "commercial-rent", "lease-comparison", "building", "tenant-screening", "office-layout", "rent-free"],
    exam: ["benkyou", "goukaku", "nenshu", "mortgage-refinance"],
  };
  for (const [cat, slugs] of Object.entries(categories)) {
    if (slugs.some((s) => slug.includes(s))) return cat;
  }
  return "other";
}

function slugToTitle(slug: string): string {
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function main() {
  console.log("Fetching sitemap index...");
  const sitemapUrls = await fetchSitemapIndex();
  console.log(`Found ${sitemapUrls.length} sitemaps`);

  const knowledgePoints: KnowledgePoint[] = [];
  const tools: Tool[] = [];
  const pastQuestions: PastQuestion[] = [];

  for (const sitemapUrl of sitemapUrls) {
    console.log(`Processing: ${sitemapUrl}`);
    const urls = await fetchSitemap(sitemapUrl);

    for (const url of urls) {
      const path = new URL(url).pathname;

      // Knowledge points: /takken/knowledge/xxx
      if (path.startsWith("/takken/knowledge/") && path !== "/takken/knowledge/") {
        const slug = path.replace("/takken/knowledge/", "").replace(/\/$/, "");
        if (slug && !slug.includes("/")) {
          knowledgePoints.push({
            id: `kp-${slug}`,
            subject: categorizeSubject(slug),
            title: slug,
            slug,
            takkenaiUrl: path,
          });
        }
      }

      // Tools: /tools/xxx
      if (path.startsWith("/tools/") && path !== "/tools/") {
        const slug = path.replace("/tools/", "").replace(/\/$/, "");
        if (slug && !slug.includes("/")) {
          tools.push({
            id: `tool-${slug}`,
            name: slug,
            slug,
            category: extractToolCategory(slug),
            takkenaiUrl: path,
          });
        }
      }

      // Past questions: /takken/past-questions/YYYY-qNN/
      const pqMatch = path.match(
        /\/takken\/past-questions\/(\d{4})-q(\d+)/
      );
      if (pqMatch) {
        const year = parseInt(pqMatch[1]);
        const num = parseInt(pqMatch[2]);
        pastQuestions.push({
          id: `pq-${year}-${num}`,
          year,
          number: num,
          subject: "mixed",
          takkenaiUrl: path,
        });
      }
    }
  }

  // Deduplicate
  const uniqueKP = Array.from(new Map(knowledgePoints.map((k) => [k.id, k])).values());
  const uniqueTools = Array.from(new Map(tools.map((t) => [t.id, t])).values());
  const uniquePQ = Array.from(new Map(pastQuestions.map((p) => [p.id, p])).values());

  console.log(`\nResults:`);
  console.log(`  Knowledge Points: ${uniqueKP.length}`);
  console.log(`  Tools: ${uniqueTools.length}`);
  console.log(`  Past Questions: ${uniquePQ.length}`);

  // Write files
  const fs = await import("fs");
  const dataDir = new URL("../data/", import.meta.url).pathname;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(dataDir + "generated", { recursive: true });

  fs.writeFileSync(
    dataDir + "knowledge-points.json",
    JSON.stringify(uniqueKP, null, 2)
  );
  fs.writeFileSync(dataDir + "tools.json", JSON.stringify(uniqueTools, null, 2));
  fs.writeFileSync(
    dataDir + "past-questions.json",
    JSON.stringify(uniquePQ, null, 2)
  );

  console.log("\nData files written to data/ directory.");
}

main().catch(console.error);
