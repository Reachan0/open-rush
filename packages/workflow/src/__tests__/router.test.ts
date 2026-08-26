// AIGC START
import { describe, expect, it } from 'vitest';
import { WEEKEND_TRIP_INTENT } from '../fixtures.js';
import { chooseLane, extractHttpUrls, needsPlaceClarification } from '../router.js';

describe('chooseLane', () => {
  it('sends coding / debugging to the agent loop', () => {
    expect(chooseLane('帮我看看这段 TypeScript 报错')).toBe('loop');
    expect(chooseLane('实现一个登录接口')).toBe('loop');
  });

  it('keeps vague nearby-travel on the loop so the agent can ask the city', () => {
    expect(needsPlaceClarification(WEEKEND_TRIP_INTENT)).toBe(true);
    expect(chooseLane(WEEKEND_TRIP_INTENT)).toBe('loop');
  });

  it('uses the workflow lane when the city is already known', () => {
    expect(chooseLane('我周六在上海，想带全家出去玩，推荐附近好玩的地方')).toBe('workflow');
    expect(chooseLane('周六从上海外滩走到上海博物馆怎么走、大概多久，今天天气怎样')).toBe(
      'workflow'
    );
  });

  it('uses the workflow lane for gather-and-compose over URLs or files', () => {
    expect(chooseLane('总结 https://example.com/a 和 https://example.com/b 写成一篇摘要')).toBe(
      'workflow'
    );
    expect(chooseLane('把工作区 README 和 package.json 汇总成一份简介')).toBe('workflow');
    expect(chooseLane('把 https://example.com 总结成一篇中文要点')).toBe('workflow');
    expect(chooseLane('把工作区 package.json 和 .env.example 汇总成一份配置简介')).toBe('workflow');
    expect(
      chooseLane('列出工作区 packages 目录，再读 packages/workflow/package.json，汇总介绍这个包')
    ).toBe('workflow');
    expect(
      chooseLane('汇总工作区的 git_status 和 package.json，告诉我仓库名和工作区是否干净')
    ).toBe('workflow');
    expect(
      chooseLane(
        '把 https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-7.html 总结成一篇中文要点'
      )
    ).toBe('workflow');
  });

  it('uses the workflow lane for open-web search-and-compose', () => {
    expect(chooseLane('帮我搜一下杭州周末亲子去处，写成一篇推荐')).toBe('workflow');
    expect(chooseLane('搜索 typescript 最佳实践写成一篇摘要')).toBe('workflow');
    expect(
      chooseLane('在工作区里搜一下 chooseLane 这个函数在哪定义，读那个文件，用口语讲它怎么分流')
    ).toBe('workflow');
  });

  it('keeps vague nearby search on the loop so the agent can ask the city', () => {
    expect(chooseLane('搜一下附近好玩的地方')).toBe('loop');
  });

  it('extracts http urls from intent text', () => {
    expect(extractHttpUrls('看 https://a.example/x，以及 http://b.example/y。')).toEqual([
      'https://a.example/x',
      'http://b.example/y',
    ]);
  });
});
// AIGC END
