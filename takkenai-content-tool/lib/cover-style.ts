import type { Platform } from "./topic-engine";

export const COVER_STYLE_IDS = [
  "lecture_blue",
  "eco_green",
  "flow_yellow",
  "impact_money",
  "cyber_blue",
  "paper_sns",
  "editorial_white",
  "real_photo_clean",
  "interview_jp_clean",
  "note_minimal_bold",
  "data_card_modern",
  "soft_lifestyle_pastel",
  "problem_solution_split",
] as const;

export type CoverStyleId = (typeof COVER_STYLE_IDS)[number];

type PlatformAffinity = Record<Platform, number>;

export interface CoverStyleOption {
  id: CoverStyleId;
  name: string;
  subtitle: string;
  previewImage: string;
  promptDirection: string;
  platformAffinity: PlatformAffinity;
}

export const DEFAULT_COVER_STYLE: CoverStyleId = "lecture_blue";

export const COVER_STYLE_OPTIONS: CoverStyleOption[] = [
  {
    id: "lecture_blue",
    name: "讲义蓝卡",
    subtitle: "深蓝讲义 + 3步要点卡",
    previewImage: "/cover-styles/lecture_blue.png",
    promptDirection:
      "上部深蓝标题栏+中部三条编号要点卡+右侧讲师形象+底部总结横条。课堂讲义感，信息清晰。",
    platformAffinity: { ameba: 70, note: 78, hatena: 92 },
  },
  {
    id: "eco_green",
    name: "清新绿教具",
    subtitle: "绿色治愈 + 吉物角色",
    previewImage: "/cover-styles/eco_green.png",
    promptDirection:
      "浅绿色背景与纸质纹理，卡通角色（如猫/机器人/讲师）和对勾清单，亲和力强。",
    platformAffinity: { ameba: 90, note: 70, hatena: 65 },
  },
  {
    id: "flow_yellow",
    name: "流程黄板书",
    subtitle: "黄底网格 + 判定流程",
    previewImage: "/cover-styles/flow_yellow.png",
    promptDirection:
      "黄色网格底，中央大标题，流程箭头和模块化信息卡，逻辑推导感明显。",
    platformAffinity: { ameba: 68, note: 72, hatena: 88 },
  },
  {
    id: "impact_money",
    name: "冲击变现",
    subtitle: "高对比爆款封面",
    previewImage: "/cover-styles/impact_money.png",
    promptDirection:
      "高对比蓝红黄配色，夸张标题和上升箭头，真人商务人物，金币/收益感符号。",
    platformAffinity: { ameba: 86, note: 84, hatena: 55 },
  },
  {
    id: "cyber_blue",
    name: "未来科技蓝",
    subtitle: "赛博蓝 + 人物机器人",
    previewImage: "/cover-styles/cyber_blue.png",
    promptDirection:
      "科技蓝背景、数据可视化元素、人物+机器人双主体，适合AI工具/指南类内容。",
    platformAffinity: { ameba: 80, note: 90, hatena: 75 },
  },
  {
    id: "paper_sns",
    name: "纸感对比卡",
    subtitle: "米色纸纹 + 三栏对照",
    previewImage: "/cover-styles/paper_sns.png",
    promptDirection:
      "米色纸张质感，三栏卡片并列对照，不同平台标签明显，信息分栏阅读感强。",
    platformAffinity: { ameba: 76, note: 88, hatena: 80 },
  },
  {
    id: "editorial_white",
    name: "编辑白刊",
    subtitle: "白底留白 + 杂志标题感",
    previewImage: "/cover-styles/editorial_white.svg",
    promptDirection:
      "白色或浅灰底，强留白，标题区块简洁，少量图形辅助，整体像编辑部专栏封面。",
    platformAffinity: { ameba: 74, note: 89, hatena: 95 },
  },
  {
    id: "real_photo_clean",
    name: "真人清爽图",
    subtitle: "真实人物 + 细条标题栏",
    previewImage: "/cover-styles/real_photo_clean.svg",
    promptDirection:
      "以真实人物场景为主，标题条细而清晰，减少花哨贴纸，强调生活化可信感。",
    platformAffinity: { ameba: 95, note: 82, hatena: 68 },
  },
  {
    id: "interview_jp_clean",
    name: "日系采访风",
    subtitle: "人物半身 + 访谈信息栏",
    previewImage: "/cover-styles/interview_jp_clean.svg",
    promptDirection:
      "杂志访谈封面风，左侧为标题与3条要点，右侧为日本职场人物半身照，浅青色干净背景，高级感。",
    platformAffinity: { ameba: 94, note: 91, hatena: 77 },
  },
  {
    id: "note_minimal_bold",
    name: "极简粗标题",
    subtitle: "单主张大字 + 强对比",
    previewImage: "/cover-styles/note_minimal_bold.svg",
    promptDirection:
      "主标题占据视觉中心，辅助元素极少，色块对比鲜明，像 note 热门头图的简洁冲击风格。",
    platformAffinity: { ameba: 79, note: 96, hatena: 70 },
  },
  {
    id: "data_card_modern",
    name: "数据卡现代",
    subtitle: "卡片图表 + 结构信息",
    previewImage: "/cover-styles/data_card_modern.svg",
    promptDirection:
      "现代卡片布局，包含图表/数据指示图形，信息层次分明，适配工具、趋势、分析内容。",
    platformAffinity: { ameba: 72, note: 92, hatena: 89 },
  },
  {
    id: "soft_lifestyle_pastel",
    name: "柔和生活感",
    subtitle: "粉彩配色 + 亲和角色",
    previewImage: "/cover-styles/soft_lifestyle_pastel.svg",
    promptDirection:
      "浅色粉彩背景，温和线条插画或角色，强调亲近感和实用感，降低营销压迫感。",
    platformAffinity: { ameba: 92, note: 81, hatena: 66 },
  },
  {
    id: "problem_solution_split",
    name: "问题解法分屏",
    subtitle: "左右对照 + 结论清晰",
    previewImage: "/cover-styles/problem_solution_split.svg",
    promptDirection:
      "左右分栏呈现“问题/解法”对照，中间用箭头或转化符号连接，适合教程和实务结论型内容。",
    platformAffinity: { ameba: 73, note: 87, hatena: 90 },
  },
];

export function isCoverStyleId(value: string): value is CoverStyleId {
  return (COVER_STYLE_IDS as readonly string[]).includes(value);
}

export function getCoverStyleOption(styleId?: string): CoverStyleOption {
  if (styleId && isCoverStyleId(styleId)) {
    const found = COVER_STYLE_OPTIONS.find((s) => s.id === styleId);
    if (found) return found;
  }
  return COVER_STYLE_OPTIONS[0];
}

export function getCoverStylesByPlatform(platform: Platform): CoverStyleOption[] {
  const rank = (item: CoverStyleOption): number => item.platformAffinity[platform] || 0;
  const order = new Map(COVER_STYLE_OPTIONS.map((item, index) => [item.id, index]));
  return [...COVER_STYLE_OPTIONS].sort((a, b) => {
    const diff = rank(b) - rank(a);
    if (diff !== 0) return diff;
    return (order.get(a.id) || 0) - (order.get(b.id) || 0);
  });
}
