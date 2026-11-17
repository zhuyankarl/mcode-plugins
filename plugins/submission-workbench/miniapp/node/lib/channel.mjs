// @ts-check
/**
 * Probe for an official marketplace submission interface and the permissions
 * that would be required to use it.
 *
 * Findings are grounded in two kinds of evidence:
 *  1. The official submission guide (read 2026-11-16) documents exactly two
 *     intake channels: a Feishu form (manual, browser, logged-in account) and a
 *     public GitHub repository. It documents no programmatic submission API.
 *  2. Runtime probes: reachability of the documented endpoints, and the tool
 *     inventory this Host actually exposes.
 *
 * When no usable submission interface exists, the app must state that plainly
 * and produce reviewable materials only — never claim a submission happened.
 */
import { GUIDE_URL } from './manifest-rules.mjs';

export const SUBMIT_FORM_URL =
  'https://vrfi1sk8a0.feishu.cn/share/base/form/shrcnbnpeor3z72fUkeHzrOE7vb';
export const STATUS_FORM_URL =
  'https://vrfi1sk8a0.feishu.cn/share/base/form/shrcncjiq3QJqP0IYEFOytcEqrh';

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   status: 'available' | 'unavailable' | 'unknown',
 *   detail: string,
 *   evidence: string,
 * }} ChannelFinding
 */

/**
 * @typedef {{
 *   checkedAt: string,
 *   submissionInterface: 'none' | 'manual_form' | 'tool',
 *   canSubmitProgrammatically: boolean,
 *   findings: ChannelFinding[],
 *   requiredPermissions: { key: string, label: string, satisfied: boolean, detail: string }[],
 *   conclusion: string,
 * }} ChannelReport
 */

const PROBE_TIMEOUT_MS = 8000;

/**
 * @param {string} url
 * @returns {Promise<{ ok: boolean, status: number | null, error: string | null }>}
 */
async function probeHttp(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { accept: 'text/html, text/plain, */*' },
    });
    return { ok: response.ok, status: response.status, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Inspect the Host tool inventory for anything that could submit a plugin to
 * the marketplace. Names are matched conservatively; no tool is called here.
 * @param {{ tool?: { list: () => Promise<{ tools: unknown[], partial: boolean }> } }} context
 * @returns {Promise<{ matched: string[], listed: number, partial: boolean, error: string | null }>}
 */
async function probeTools(context) {
  if (!context.tool || typeof context.tool.list !== 'function') {
    return { matched: [], listed: 0, partial: false, error: '本 Host 未暴露 tool 接口' };
  }
  try {
    const result = await context.tool.list();
    const tools = Array.isArray(result.tools) ? result.tools : [];
    const matched = [];
    for (const tool of tools) {
      if (!tool || typeof tool !== 'object') continue;
      const name = typeof tool.name === 'string' ? tool.name : '';
      const description = typeof tool.description === 'string' ? tool.description : '';
      const haystack = `${name} ${description}`.toLowerCase();
      const talksMarketplace =
        /(marketplace|plugin|上架|投稿|submit)/.test(haystack) &&
        /(submit|publish|upload|上架|投稿|发布)/.test(haystack);
      if (talksMarketplace) matched.push(name);
    }
    return { matched, listed: tools.length, partial: Boolean(result.partial) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { matched: [], listed: 0, partial: false, error: message };
  }
}

/**
 * Build the submission-channel report.
 * @param {{ tool?: unknown }} context
 * @param {{ submitAccount: string, submitEmail: string, organization: string }} draft
 * @returns {Promise<ChannelReport>}
 */
export async function probeSubmissionChannel(context, draft) {
  /** @type {ChannelFinding[]} */
  const findings = [];

  const [guide, form, status] = await Promise.all([
    probeHttp(GUIDE_URL),
    probeHttp(SUBMIT_FORM_URL),
    probeHttp(STATUS_FORM_URL),
  ]);

  findings.push({
    id: 'guide',
    label: '官方上架指南',
    status: guide.ok ? 'available' : 'unknown',
    detail: guide.ok
      ? `指南可访问（HTTP ${guide.status}）。指南写明受理入口只有飞书表单与公开 GitHub 仓库两种。`
      : `无法访问指南（${guide.error ?? `HTTP ${guide.status}`}），受理入口以最新指南为准。`,
    evidence: `GET ${GUIDE_URL}`,
  });

  findings.push({
    id: 'form',
    label: '飞书投稿表单',
    status: form.ok ? 'available' : 'unknown',
    detail: form.ok
      ? `表单可访问（HTTP ${form.status}），但需人工在浏览器中登录飞书账号后提交。`
      : `暂时无法访问表单（${form.error ?? `HTTP ${form.status}`}）。`,
    evidence: `GET ${SUBMIT_FORM_URL}`,
  });

  findings.push({
    id: 'status',
    label: '进度查询表单',
    status: status.ok ? 'available' : 'unknown',
    detail: status.ok
      ? `查询表单可访问（HTTP ${status.status}），查询需要原提交账号 + submission_id + 提交邮箱三者匹配。`
      : `暂时无法访问查询表单（${status.error ?? `HTTP ${status.status}`}）。`,
    evidence: `GET ${STATUS_FORM_URL}`,
  });

  const toolProbe = await probeTools(/** @type {any} */ (context));
  const submissionTools = toolProbe.matched;
  findings.push({
    id: 'tool',
    label: '本机可用的投稿工具',
    status: submissionTools.length > 0 ? 'available' : 'unavailable',
    detail:
      submissionTools.length > 0
        ? `发现可能的投稿工具：${submissionTools.join('、')}。本工具不会自动调用它们。`
        : toolProbe.error
          ? `无法枚举本机工具：${toolProbe.error}`
          : `已枚举 ${toolProbe.listed} 个工具，未发现官方市场的投稿接口。`,
    evidence: 'context.tool.list()',
  });

  const requiredPermissions = [
    {
      key: 'feishuAccount',
      label: '飞书账号（提交与查询进度时使用同一账号）',
      satisfied: draft.submitAccount.trim() !== '',
      detail: draft.submitAccount.trim() === '' ? '未填写' : `已填写：${draft.submitAccount.trim()}`,
    },
    {
      key: 'submitEmail',
      label: '提交邮箱（查询进度需与 submission_id、账号三者匹配）',
      satisfied: draft.submitEmail.trim() !== '',
      detail: draft.submitEmail.trim() === '' ? '未填写' : `已填写：${draft.submitEmail.trim()}`,
    },
    {
      key: 'organization',
      label: '组织/团队名称',
      satisfied: draft.organization.trim() !== '',
      detail: draft.organization.trim() === '' ? '未填写' : `已填写：${draft.organization.trim()}`,
    },
  ];

  const programmatic = submissionTools.length > 0;
  const conclusion = programmatic
    ? '本机存在可能的投稿工具，但本应用不代替你提交：仍只生成可审核材料，由你确认后手动执行提交。'
    : '未发现官方市场的程序化提交接口。官方受理入口为飞书表单（人工提交）与公开 GitHub 仓库，本应用因此只生成可审核的上架材料，不代表已提交或已上架。';

  return {
    checkedAt: new Date().toISOString(),
    submissionInterface: programmatic ? 'tool' : 'manual_form',
    canSubmitProgrammatically: false,
    findings,
    requiredPermissions,
    conclusion,
  };
}
