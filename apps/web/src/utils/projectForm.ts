/** number 输入框的 v-model 可能返回数字，也可能在清空后返回空字符串。 */
export function normalizePortInput(value: string | number): number | null {
  const raw = String(value).trim();
  if (!raw) return null;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须是 1-65535 的整数');
  return port;
}
