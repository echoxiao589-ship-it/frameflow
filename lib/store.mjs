import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const STEPS = ['script', 'outline', 'scenes', 'visuals', 'audio', 'review', 'export'];
export const LABELS = ['生成脚本', '生成大纲', '拆分分镜', '生成分镜画面', '生成分镜声音', '预览与修改', '录屏输出'];
export class Problem extends Error { constructor(status, message) { super(message); this.status = status; } }
export function requireValue(condition, message, status = 400) { if (!condition) throw new Problem(status, message); }
export function textValue(value, label, max = 12000) {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${label}不能为空且不能超过 ${max} 字`);
  return value.trim();
}
export function invalidate(project, from) {
  for (let i = STEPS.indexOf(from); i < STEPS.length; i++) project.steps[STEPS[i]] = { status: 'pending' };
  const index = STEPS.indexOf(from);
  if (index <= 1) project.outline = [];
  if (index <= 2) project.scenes = [];
  if (index <= 3) project.scenes.forEach(s => { s.visual = null; });
  if (index <= 4) { project.scenes.forEach(s => { s.audio = null; }); project.music = null; }
  project.reviewedAt = null;
  project.exportTicket = null;
}
export function assertPrevious(project, step) {
  const index = STEPS.indexOf(step);
  requireValue(index >= 0, '未知制作步骤');
  for (let i = 0; i < index; i++) requireValue(project.steps[STEPS[i]].status === 'completed', `请先完成「${LABELS[i]}」`, 409);
}
export function createStore(root) {
  mkdirSync(root, { recursive: true });
  const file = join(root, 'projects.json');
  let projects;
  try { projects = JSON.parse(readFileSync(file, 'utf8')); if (!Array.isArray(projects)) throw new Error('数据格式无效'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; projects = []; }
  function save() { const tmp = file + '.tmp'; writeFileSync(tmp, JSON.stringify(projects, null, 2)); renameSync(tmp, file); }
  let recovered = false;
  for (const p of projects) for (const state of Object.values(p.steps)) if (state.status === 'running') {
    state.status = 'failed'; state.error = '服务在生成过程中重启，请重试此步骤'; p.revision++; recovered = true;
  }
  if (recovered) save();
  return {
    list: () => projects,
    get(id) { const p = projects.find(p => p.id === id); requireValue(p, '项目不存在', 404); return p; },
    add(mode, prompt) {
      requireValue(['image', 'html'].includes(mode), '请选择图片轮播或 HTML 视频模式');
      const p = { id: randomUUID(), mode, prompt: prompt || '', title: prompt ? prompt.slice(0, 24) : '未命名视频', revision: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        steps: Object.fromEntries(STEPS.map(s => [s, { status: 'pending' }])), script: '', outline: [], scenes: [],
        music: null, musicStyle: 'gentle', exports: [], messages: [], reviewedAt: null };
      projects.unshift(p); save(); return p;
    },
    touch(p) { p.revision++; p.updatedAt = new Date().toISOString(); save(); },
    remove(id) { projects = projects.filter(p => p.id !== id); save(); }
  };
}
