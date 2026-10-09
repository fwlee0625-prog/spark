import type { DetectResult } from '@spark/shared';
import { detectNode } from './node.js';
import { detectPython } from './python.js';

/** 依次尝试 Node / Python 识别;都不命中则返回通用兜底。结果仅用于预填,不强制。 */
export function detect(dir: string): DetectResult {
  return (
    detectNode(dir) ??
    detectPython(dir) ?? {
      type: 'generic',
      suggestedCommand: null,
      notes: ['未识别到 Node / Python 项目特征,请手动填写启动命令'],
    }
  );
}
