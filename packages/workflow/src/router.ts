// AIGC START
import { looksLikeTravelIntent } from './generate.js';

export type AgentLane = 'workflow' | 'loop';

const EXPLICIT_WORKFLOW = /用工作流|快车道|workflow-run|json dag/i;
const CODE_HINT =
  /实现|重构|修\s*bug|debug|git\s|commit|typescript|报错|stack trace|写一个函数|帮我看看代码|改一下这[个份]文件/i;
const SEARCH_HINT = /搜索|搜一下|网上搜|web\s*search|检索/;
const GATHER = /汇总|总结|综述|对比|整理成|写成(一篇|报告|摘要)/;
const FILE_HINT = /readme|package\.json|文件|工作区|\.md\b/i;
const CITY_HINT = /上海|北京|杭州|广州|深圳|成都|南京|武汉|西安|重庆|苏州|天津|青岛|厦门|城市/;

export function extractHttpUrls(intent: string): string[] {
  const matches = intent.match(/https?:\/\/[^\s)\]>'"，。,]+/gi) ?? [];
  return matches.map((url) => url.replace(/[.,，。]+$/u, ''));
}

export function needsPlaceClarification(intent: string): boolean {
  if (!/附近|周边/.test(intent)) return false;
  return !CITY_HINT.test(intent);
}

export function chooseLane(intent: string): AgentLane {
  const text = intent.trim();
  if (!text) return 'loop';
  if (EXPLICIT_WORKFLOW.test(text)) return 'workflow';
  if (needsPlaceClarification(text)) return 'loop';
  const urls = extractHttpUrls(text);
  if (urls.length >= 1 && GATHER.test(text)) return 'workflow';
  if (GATHER.test(text) && FILE_HINT.test(text)) return 'workflow';
  if (CODE_HINT.test(text) && !SEARCH_HINT.test(text)) return 'loop';
  if (SEARCH_HINT.test(text)) return 'workflow';
  if (CODE_HINT.test(text)) return 'loop';
  if (looksLikeTravelIntent(text)) return 'workflow';
  return 'loop';
}
// AIGC END
