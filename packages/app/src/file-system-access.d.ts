/**
 * File System Access API surface missing from lib.dom (per-handle permission
 * methods + the directory picker). Same augmentation flexo uses.
 */
declare global {
  interface FileSystemHandle {
    queryPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
    requestPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  }
  interface Window {
    showDirectoryPicker?(options?: {
      id?: string
      mode?: 'read' | 'readwrite'
      startIn?: string | FileSystemHandle
    }): Promise<FileSystemDirectoryHandle>
  }
}

export {}
