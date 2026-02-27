import type { Platform } from "./topic-engine";

export type ArticleType =
  | "tool-ranking"
  | "competitor-compare"
  | "practical-guide"
  | "how-to"
  | "trend-analysis"
  | "case-review"
  | "pitfall-checklist"
  | "template-pack";

export type CoreArticleType =
  | "tool-ranking"
  | "competitor-compare"
  | "practical-guide"
  | "how-to"
  | "trend-analysis"
  | "case-review";

export type AssetType = "knowledge-point" | "tool" | "past-question";

export interface ArticleTypeOption {
  id: ArticleType;
  label: string;
  shortLabel: string;
  description: string;
  focus: string;
  mustHave: string[];
  avoid: string[];
  core: boolean;
  enabledByDefault: boolean;
}

export const ARTICLE_TYPE_OPTIONS: ArticleTypeOption[] = [
  {
    id: "tool-ranking",
    label: "工具排行",
    shortLabel: "排行",
    description: "用评估维度给出工具排序与推荐场景",
    focus: "选型决策",
    mustHave: ["评估维度", "排序逻辑", "适用人群", "结论"],
    avoid: ["只列名字不解释", "没有推荐边界"],
    core: true,
    enabledByDefault: true,
  },
  {
    id: "competitor-compare",
    label: "竞品对比",
    shortLabel: "对比",
    description: "围绕同一场景做A/B对比，给出取舍建议",
    focus: "替代选择",
    mustHave: ["对比维度", "优劣边界", "场景建议"],
    avoid: ["绝对化结论", "营销口号式比较"],
    core: true,
    enabledByDefault: true,
  },
  {
    id: "practical-guide",
    label: "实操指南",
    shortLabel: "指南",
    description: "定义到流程再到注意点的完整实务导向",
    focus: "体系化理解",
    mustHave: ["定义", "流程", "注意点", "FAQ"],
    avoid: ["空泛理论堆砌"],
    core: true,
    enabledByDefault: true,
  },
  {
    id: "how-to",
    label: "How-to教程",
    shortLabel: "How-to",
    description: "可直接执行的步骤化教程",
    focus: "立刻执行",
    mustHave: ["3步以上", "参数示例", "常见错误处理"],
    avoid: ["只有概念没有步骤"],
    core: true,
    enabledByDefault: true,
  },
  {
    id: "trend-analysis",
    label: "趋势解读",
    shortLabel: "趋势",
    description: "用数据与来源解释趋势变化及影响",
    focus: "认知升级与流量",
    mustHave: ["来源+年份+数值", "趋势影响", "行动建议"],
    avoid: ["无依据的趋势判断"],
    core: true,
    enabledByDefault: true,
  },
  {
    id: "case-review",
    label: "案例复盘",
    shortLabel: "案例",
    description: "以具体案例拆解判断过程与可复用方法",
    focus: "场景迁移",
    mustHave: ["背景", "判断过程", "结果", "复用方法"],
    avoid: ["流水账叙述"],
    core: true,
    enabledByDefault: true,
  },
  {
    id: "pitfall-checklist",
    label: "避坑清单",
    shortLabel: "避坑",
    description: "归纳高频错误与纠偏动作",
    focus: "风险控制",
    mustHave: ["错误信号", "后果", "纠偏动作"],
    avoid: ["只讲风险不讲处理"],
    core: false,
    enabledByDefault: false,
  },
  {
    id: "template-pack",
    label: "模板/清单包",
    shortLabel: "模板",
    description: "提供可复用模板与执行清单",
    focus: "执行效率",
    mustHave: ["模板结构", "填写示例", "使用场景"],
    avoid: ["模板不可直接使用"],
    core: false,
    enabledByDefault: false,
  },
];

const ARTICLE_TYPE_SET = new Set<ArticleType>(
  ARTICLE_TYPE_OPTIONS.map((item) => item.id)
);

const CORE_ARTICLE_TYPE_SET = new Set<ArticleType>(
  ARTICLE_TYPE_OPTIONS.filter((item) => item.core).map((item) => item.id)
);

export function isArticleType(value: unknown): value is ArticleType {
  return typeof value === "string" && ARTICLE_TYPE_SET.has(value as ArticleType);
}

export function isCoreArticleType(value: unknown): value is CoreArticleType {
  return (
    typeof value === "string" && CORE_ARTICLE_TYPE_SET.has(value as CoreArticleType)
  );
}

export function getArticleTypeOption(articleType: ArticleType): ArticleTypeOption {
  const found = ARTICLE_TYPE_OPTIONS.find((item) => item.id === articleType);
  return found || ARTICLE_TYPE_OPTIONS[0];
}

export function getEnabledArticleTypeOptions(includeExtended = false): ArticleTypeOption[] {
  return ARTICLE_TYPE_OPTIONS.filter((item) =>
    includeExtended ? true : item.enabledByDefault
  );
}

export function getEnabledArticleTypes(includeExtended = false): ArticleType[] {
  return getEnabledArticleTypeOptions(includeExtended).map((item) => item.id);
}

export function getRecommendedArticleType(
  platform: Platform,
  assetType?: AssetType
): CoreArticleType {
  const byAssetType: Record<AssetType, CoreArticleType> = {
    tool: platform === "ameba" ? "how-to" : platform === "note" ? "competitor-compare" : "tool-ranking",
    "knowledge-point": "practical-guide",
    "past-question": platform === "note" ? "trend-analysis" : "case-review",
  };

  if (assetType && byAssetType[assetType]) {
    return byAssetType[assetType];
  }

  if (platform === "ameba") return "how-to";
  if (platform === "note") return "practical-guide";
  return "case-review";
}

export function resolveArticleType(
  input: unknown,
  fallback: CoreArticleType = "practical-guide"
): CoreArticleType {
  if (isCoreArticleType(input)) return input;
  return fallback;
}

export function buildArticleTypePromptBlock(articleType: ArticleTypeOption): string {
  const mustLine = articleType.mustHave.map((item) => `- ${item}`).join("\n");
  const avoidLine = articleType.avoid.map((item) => `- ${item}`).join("\n");
  return [
    `タイプ: ${articleType.label}（${articleType.focus}）`,
    "必須要素:",
    mustLine,
    "禁止傾向:",
    avoidLine,
  ].join("\n");
}
