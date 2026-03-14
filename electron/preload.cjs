const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('forkApi', {
  app: {
    bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  },
  sources: {
    list: () => ipcRenderer.invoke('sources:list'),
  },
  capture: {
    primeSync: (payload) => ipcRenderer.sendSync('capture:prime-sync', payload),
    prepare: (payload) => ipcRenderer.invoke('capture:prepare', payload),
    startNativeScreenRecording: (payload) => ipcRenderer.invoke('capture:start-native-screen-recording', payload),
    stopNativeScreenRecording: (payload) => ipcRenderer.invoke('capture:stop-native-screen-recording', payload),
    getCursorAppearanceCatalog: () => ipcRenderer.invoke('capture:get-cursor-appearance-catalog'),
    getCursorSnapshot: () => ipcRenderer.invoke('capture:get-cursor-snapshot'),
    saveRecording: ({ buffer, existingFilePath, mimeType, fileName, systemAudio, camera, microphone, clip }) => {
      if (existingFilePath) {
        return ipcRenderer.invoke('capture:save-recording', {
          existingFilePath,
          mimeType,
          fileName,
          systemAudio: systemAudio
            ? {
                base64Data: Buffer.from(new Uint8Array(systemAudio.buffer)).toString('base64'),
                byteLength: systemAudio.buffer.byteLength,
                mimeType: systemAudio.mimeType,
                fileName: systemAudio.fileName,
              }
            : null,
          camera: camera
            ? {
                base64Data: Buffer.from(new Uint8Array(camera.buffer)).toString('base64'),
                byteLength: camera.buffer.byteLength,
                mimeType: camera.mimeType,
                fileName: camera.fileName,
                deviceId: camera.deviceId,
                deviceLabel: camera.deviceLabel,
              }
            : null,
          microphone: microphone
            ? {
                base64Data: Buffer.from(new Uint8Array(microphone.buffer)).toString('base64'),
                byteLength: microphone.buffer.byteLength,
                mimeType: microphone.mimeType,
                fileName: microphone.fileName,
                deviceId: microphone.deviceId,
                deviceLabel: microphone.deviceLabel,
              }
            : null,
          clip,
        })
      }

      const bytes = new Uint8Array(buffer)
      return ipcRenderer.invoke('capture:save-recording', {
        base64Data: Buffer.from(bytes).toString('base64'),
        byteLength: bytes.byteLength,
        mimeType,
        fileName,
        systemAudio: systemAudio
          ? {
              base64Data: Buffer.from(new Uint8Array(systemAudio.buffer)).toString('base64'),
              byteLength: systemAudio.buffer.byteLength,
              mimeType: systemAudio.mimeType,
              fileName: systemAudio.fileName,
            }
          : null,
        camera: camera
          ? {
              base64Data: Buffer.from(new Uint8Array(camera.buffer)).toString('base64'),
              byteLength: camera.buffer.byteLength,
              mimeType: camera.mimeType,
              fileName: camera.fileName,
              deviceId: camera.deviceId,
              deviceLabel: camera.deviceLabel,
            }
          : null,
        microphone: microphone
          ? {
              base64Data: Buffer.from(new Uint8Array(microphone.buffer)).toString('base64'),
              byteLength: microphone.buffer.byteLength,
              mimeType: microphone.mimeType,
              fileName: microphone.fileName,
              deviceId: microphone.deviceId,
              deviceLabel: microphone.deviceLabel,
            }
          : null,
        clip,
      })
    },
  },
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (patch) => ipcRenderer.invoke('settings:save', patch),
  },
  importState: {
    scan: () => ipcRenderer.invoke('import:scan'),
    run: () => ipcRenderer.invoke('import:run'),
  },
  project: {
    load: () => ipcRenderer.invoke('project:load'),
    list: () => ipcRenderer.invoke('project:list'),
    save: (patch) => ipcRenderer.invoke('project:save', patch),
    create: (payload) => ipcRenderer.invoke('project:create', payload),
    open: (projectId) => ipcRenderer.invoke('project:open', projectId),
    duplicate: (projectId) => ipcRenderer.invoke('project:duplicate', projectId),
    remove: (projectId) => ipcRenderer.invoke('project:remove', projectId),
    importBackgroundImage: () => ipcRenderer.invoke('project:import-background-image'),
    importMusicBed: () => ipcRenderer.invoke('project:import-music-bed'),
    removeMusicBed: (bedId) => ipcRenderer.invoke('project:remove-music-bed', bedId),
    analyzeClipAudio: (clipId) => ipcRenderer.invoke('project:analyze-clip-audio', clipId),
    generateTranscript: (clipId) => ipcRenderer.invoke('project:generate-transcript', clipId),
    importTranscript: (clipId) => ipcRenderer.invoke('project:import-transcript', clipId),
    saveAudioRetake: ({
      clipId,
      segmentId,
      segmentText,
      startSeconds,
      endSeconds,
      buffer,
      mimeType,
      fileName,
      deviceId,
      deviceLabel,
    }) =>
      ipcRenderer.invoke('project:save-audio-retake', {
        clipId,
        segmentId,
        segmentText,
        startSeconds,
        endSeconds,
        base64Data: Buffer.from(new Uint8Array(buffer)).toString('base64'),
        byteLength: buffer.byteLength,
        mimeType,
        fileName,
        deviceId,
        deviceLabel,
      }),
    exportClip: (payload) => ipcRenderer.invoke('project:export-clip', payload),
    exportTimeline: (payload) => ipcRenderer.invoke('project:export-timeline', payload),
  },
  shell: {
    showInFolder: (targetPath) => ipcRenderer.invoke('shell:show-in-folder', targetPath),
    copyText: (value) => ipcRenderer.invoke('shell:copy-text', value),
  },
})
