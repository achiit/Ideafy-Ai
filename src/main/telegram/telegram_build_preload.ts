import { ipcRenderer, contextBridge } from 'electron';
import type { ChatStreamParams } from '../../ipc/ipc_types';

contextBridge.exposeInMainWorld('electronAPI', {
  startBuild: (params: ChatStreamParams) => {
    return ipcRenderer.invoke('chat:stream', params);
  }
}); 