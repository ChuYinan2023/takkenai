import type { Platform } from "./topic-engine";
import type { ArticleType } from "./article-type";

const DATA_CITATION_REGEX =
  /(出典|調査|統計|データ|公表|発表|白書|資料|レポート|国土交通省|総務省|厚生労働省|金融庁|内閣府|消費者庁|国税庁|source|来源)/i;
const YEAR_REGEX =
  /(?:19|20)\d{2}(?:年|年度)?|令和\d+年(?:度)?|平成\d+年(?:度)?|昭和\d+年(?:度)?/;

function splitLines(body: string): string[] {
  return (body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function headingCount(body: string): number {
  return (body.match(/^##+\s+/gm) || []).length;
}

function bulletCount(body: string): number {
  return (body.match(/^\s*(?:[-*]|\d+\.)\s+/gm) || []).length;
}

function hasFaq(body: string): boolean {
  const hasHeading = /(?:^|\n)##+\s*(?:FAQ|よくある質問|Q&A|Q＆A)/im.test(body);
  if (!hasHeading) return false;
  const qCount =
    (body.match(/^\s*(?:\*\*)?Q(?:[0-9０-９]+(?:[.．:：])?|[:：])\s*/gim) || []).length;
  const aCount =
    (body.match(/^\s*(?:\*\*)?A(?:[0-9０-９]+(?:[.．:：])?|[:：])\s*/gim) || []).length;
  return qCount >= 1 && aCount >= 1;
}

function hasNumberedSteps(body: string): boolean {
  const numberedLines = (body.match(/^\s*(?:\d+\.|ステップ\s*\d+|手順\s*\d+)/gim) || []).length;
  return numberedLines >= 3;
}

function hasCompareSignals(body: string): boolean {
  return /(比較|違い|使い分け|A\/B|メリット|デメリット|向いている)/i.test(body);
}

function hasRankingSignals(body: string): boolean {
  return /(ランキング|順位|TOP\s*\d|第\s*\d+位|1位|2位|3位)/i.test(body);
}

function hasDefinitionSignals(body: string): boolean {
  return /(とは|定義|意味)/.test(body);
}

function hasFlowSignals(body: string): boolean {
  return /(手順|流れ|ステップ|進め方|実行)/.test(body);
}

function hasCautionSignals(body: string): boolean {
  return /(注意点|注意事項|落とし穴|よくあるミス|失敗しやすい)/.test(body);
}

function hasTrendSignals(body: string): boolean {
  return /(トレンド|動向|推移|変化|市場)/.test(body);
}

function hasTrendEvidenceSignals(body: string): boolean {
  return DATA_CITATION_REGEX.test(body) && YEAR_REGEX.test(body);
}

function hasActionSignals(body: string): boolean {
  return /(対策|アクション|次に取るべき|実務での使い方|行動)/.test(body);
}

function hasCaseSignals(body: string): boolean {
  return /(ケース|事例|背景|シナリオ|場面)/.test(body);
}

function hasProcessSignals(body: string): boolean {
  return /(判断|検討|比較|手順|対応)/.test(body);
}

function hasResultSignals(body: string): boolean {
  return /(結果|学び|再現|改善|次回に活かす)/.test(body);
}

function hasTemplateSignals(body: string): boolean {
  return /(テンプレート|雛形|チェックリスト|記入例|フォーマット)/.test(body);
}

function addIssue(issues: string[], condition: boolean, issue: string): void {
  if (!condition) issues.push(issue);
}

export function validateArticleTypeStructure(
  body: string,
  articleType: ArticleType,
  platform: Platform
): string[] {
  const issues: string[] = [];
  const text = body || "";

  addIssue(issues, headingCount(text) >= 2, "类型结构不足：H2/H3 小节不足（至少2个）");

  switch (articleType) {
    case "tool-ranking":
      addIssue(issues, hasRankingSignals(text), "工具排行类型缺少排序信号（如第1位/ランキング）");
      addIssue(issues, bulletCount(text) >= 3, "工具排行类型缺少至少3条可比较要点");
      addIssue(issues, /(適用|向いている|対象)/.test(text), "工具排行类型缺少适用人群/场景说明");
      break;

    case "competitor-compare":
      addIssue(issues, hasCompareSignals(text), "竞品对比类型缺少比较维度描述");
      addIssue(issues, /(メリット|強み)/.test(text), "竞品对比类型缺少优势说明");
      addIssue(issues, /(デメリット|弱み|注意)/.test(text), "竞品对比类型缺少劣势或边界说明");
      break;

    case "practical-guide":
      addIssue(issues, hasDefinitionSignals(text), "实操指南类型缺少定义段（〜とは）");
      addIssue(issues, hasFlowSignals(text), "实操指南类型缺少流程/步骤说明");
      addIssue(issues, hasCautionSignals(text), "实操指南类型缺少注意点/易错点");
      addIssue(issues, hasFaq(text), "实操指南类型建议包含FAQ段落（Q/A形式）");
      break;

    case "how-to":
      addIssue(issues, hasNumberedSteps(text), "How-to类型缺少3步以上明确步骤");
      addIssue(issues, /(例|サンプル|入力例|設定例)/.test(text), "How-to类型缺少参数/示例说明");
      addIssue(issues, /(エラー|つまずき|失敗|対処)/.test(text), "How-to类型缺少常见错误与处理");
      break;

    case "trend-analysis":
      addIssue(issues, hasTrendSignals(text), "趋势解读类型缺少趋势变化描述");
      addIssue(
        issues,
        hasTrendEvidenceSignals(text),
        "趋势解读类型缺少来源+年份的证据"
      );
      addIssue(issues, hasActionSignals(text), "趋势解读类型缺少行动建议");
      break;

    case "case-review":
      addIssue(issues, hasCaseSignals(text), "案例复盘类型缺少案例背景");
      addIssue(issues, hasProcessSignals(text), "案例复盘类型缺少判断过程");
      addIssue(issues, hasResultSignals(text), "案例复盘类型缺少结果与复用方法");
      break;

    case "pitfall-checklist":
      addIssue(issues, /(落とし穴|よくあるミス|失敗)/.test(text), "避坑清单类型缺少错误信号描述");
      addIssue(issues, bulletCount(text) >= 3, "避坑清单类型缺少至少3条清单项");
      break;

    case "template-pack":
      addIssue(issues, hasTemplateSignals(text), "模板/清单包类型缺少模板或清单结构");
      addIssue(issues, /(使い方|記入|運用|手順)/.test(text), "模板/清单包类型缺少使用方法");
      break;
  }

  if (platform === "ameba") {
    addIssue(issues, text.length >= 500, "Ameba 正文内容过短，类型表达不完整");
  }

  return issues;
}

function containsAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function applyArticleTypeFallbackStructure(
  body: string,
  articleType: ArticleType,
  keyword: string
): string {
  let text = (body || "").trim();
  if (!text) return text;

  const safeKeyword = (keyword || "このテーマ").trim();

  if (articleType === "tool-ranking" && !hasRankingSignals(text)) {
    text += `\n\n## ${safeKeyword}の選定ランキング（実務視点）`;
    text += "\n1. 第1位: 導入ハードルと再現性のバランスが良い選択";
    text += "\n2. 第2位: 特定業務で効果が高いが、運用設計が必要";
    text += "\n3. 第3位: 学習コストはあるが中長期で安定運用しやすい";
  }

  if (articleType === "competitor-compare" && !hasCompareSignals(text)) {
    text += `\n\n## ${safeKeyword}を比較する前に見る観点`;
    text +=
      "\n導入速度、既存業務との整合、運用負荷の3点を同じ条件で並べると、比較判断の再現性が上がります。";
  }
  if (articleType === "competitor-compare" && !/(メリット|強み)/.test(text)) {
    text += "\n\n## 採用しやすい場面";
    text +=
      "\n前提条件が明確で短期間に検証したいケースでは、導入初期に判断しやすい強みが出やすくなります。";
  }
  if (articleType === "competitor-compare" && !/(デメリット|弱み|注意)/.test(text)) {
    text += "\n\n## 判断を誤りやすい境界条件";
    text +=
      "\n注意点として、目的と評価軸が曖昧なまま導入するとデメリットが目立ちやすく、比較結果がぶれやすくなります。";
  }

  if (articleType === "practical-guide") {
    if (!hasDefinitionSignals(text)) {
      text += `\n\n## ${safeKeyword}とは`;
      text += `\n${safeKeyword}は、実務判断の精度を上げるための基準を整理する考え方です。`;
    }
    if (!hasFlowSignals(text)) {
      text += `\n\n## ${safeKeyword}の判断手順`;
      text += "\n1. まず対象範囲と適用条件を確認する";
      text += "\n2. 次に判断基準を同じ条件で比較する";
      text += "\n3. 最後に例外条件と数値要件を照合する";
    }
    if (!hasCautionSignals(text)) {
      text += `\n\n## ${safeKeyword}で失敗しやすい点`;
      text +=
        "\n結論を先に固定せず、根拠と例外を同じ段階で確認すると誤判定を避けやすくなります。";
    }
    if (!hasFaq(text)) {
      text += "\n\n## FAQ";
      text += `\nQ: ${safeKeyword}は何から始めるべきですか？`;
      text += "\nA: まず定義と基本手順を押さえ、短い実例で確認すると定着しやすくなります。";
      text += "\nQ: 実務で迷ったときはどう確認すればよいですか？";
      text += "\nA: 結論→根拠→例外の順に確認し、最後に数字条件を照合すると判断が安定します。";
    }
  }

  if (articleType === "how-to" && !hasNumberedSteps(text)) {
    text += `\n\n## ${safeKeyword}の実行手順`;
    text += "\n1. 目的に対して前提条件と評価基準をそろえます。";
    text += "\n2. 入力条件（例：期間、条件、閾値）を揃えて1回実行します。";
    text += "\n3. 出力を確認し、ズレがあれば前提条件か係数を微調整します。";
    text += `\n\n## ${safeKeyword}で失敗しやすい点`;
    text += "\n- まず、入力順・必須項目・閾値の整合を確認することで手戻りを減らせます。";
  }

  // trend-analysis は固定テンプレ追記をしない。
  // 理由: 「直近の動向/実務アクション」等の定型段は読者向け本文として不自然になりやすく、
  // 実データ未確認のまま根拠文を足すと品質を下げるため。

  if (articleType === "case-review" && !hasCaseSignals(text)) {
    text += "\n\n## ケース背景";
    text += "\n現場で判断が分かれやすい場面を想定し、前提条件を揃えて検討します。";
    text += "\n\n## 判断プロセスと結果";
    text += "\n論点を分解して順番に確認することで、再現可能な判断手順を作れます。";
  }

  if (articleType === "pitfall-checklist" && !containsAny(text, [/(落とし穴|ミス|失敗)/])) {
    text += "\n\n## よくある落とし穴チェック";
    text += "\n- 前提条件を確認せずに結論を出す";
    text += "\n- 例外条件を最後まで確認しない";
    text += "\n- 出典のない情報をそのまま使う";
  }

  if (articleType === "template-pack" && !hasTemplateSignals(text)) {
    text += "\n\n## すぐ使えるテンプレート";
    text += "\n- 目的: 何を判断したいか";
    text += "\n- 前提: 必要な入力条件";
    text += "\n- 手順: 確認順序と判定基準";
  }

  const currentLines = splitLines(text);
  if (currentLines.length < 6) {
    text += `\n\n${safeKeyword}を扱う場面を1つ決め、入力条件と判断根拠を並べて確認すると理解が定着しやすくなります。`;
  }

  const currentHeadingCount = headingCount(text);
  if (currentHeadingCount < 2) {
    text += `\n\n## ${safeKeyword}の要点`;
    text += "\n判断基準を先に固定し、例外条件を後から照合すると再現性が上がります。";
  }
  if (headingCount(text) < 2) {
    text += `\n\n## ${safeKeyword}の実務適用`;
    text += "\n小さなケースで手順を検証してから本番運用に展開してください。";
  }

  return text.trim();
}
