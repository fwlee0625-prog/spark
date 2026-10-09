import { ApiError, api } from '../api/client.js';
import { refreshProjects } from '../stores/app.js';
import { confirmAction } from './confirm.js';
import { toast } from './toast.js';

/** 启动项目;端口被占用(409)时弹确认,可强制启动 */
export async function startProjectAction(id: string, name: string): Promise<void> {
  try {
    await api.startProject(id);
    toast(`已发出 ${name} 的启动指令`, 'success');
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && err.data.error === 'PORT_IN_USE') {
      const st = err.data.port;
      const who =
        st?.source === 'project' ? `项目「${st.projectName ?? '?'}」` : `外部进程 ${st?.pid ?? '?'} (${st?.processName ?? '未知'})`;
      const ok = await confirmAction({
        title: '端口被占用',
        message: `端口 ${st?.port} 已被${who}占用。\n仍要强制启动「${name}」吗?`,
        confirmText: '仍然启动',
      });
      if (ok) {
        try {
          await api.startProject(id, true);
          toast(`「${name}」强制启动中`, 'success');
        } catch (err2) {
          toast(`启动失败:${(err2 as Error).message}`, 'error');
        }
      }
      return;
    }
    toast(`「${name}」启动失败:${(err as Error).message}`, 'error');
  }
}

export async function stopProjectAction(id: string, name: string): Promise<void> {
  try {
    await api.stopProject(id);
    toast(`「${name}」已停止`, 'success');
  } catch (err) {
    toast(`「${name}」停止失败:${(err as Error).message}`, 'error');
  }
}

export async function restartProjectAction(id: string, name: string): Promise<void> {
  try {
    await api.restartProject(id);
    toast(`「${name}」重启中`, 'success');
  } catch (err) {
    toast(`「${name}」重启失败:${(err as Error).message}`, 'error');
  }
}

export async function deleteProjectAction(id: string, name: string): Promise<boolean> {
  const ok = await confirmAction({
    title: '删除项目',
    message: `确定删除「${name}」吗?\n仅移除管理配置,不会删除项目文件。`,
    confirmText: '删除',
    danger: true,
  });
  if (!ok) return false;
  try {
    await api.deleteProject(id);
    toast(`「${name}」已删除`, 'success');
    await refreshProjects();
    return true;
  } catch (err) {
    toast(`删除失败:${(err as Error).message}`, 'error');
    return false;
  }
}
