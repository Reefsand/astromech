// The few things the page may ask of the app: take or release the mouse, move the window,
// open a conversation; and the beeps the app asks the page to play.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('astromech', {
  grab: over => ipcRenderer.send('grab', Boolean(over)),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  open: id => ipcRenderer.send('open', typeof id === 'string' ? id : null),
  onBeep: callback => ipcRenderer.on('beep', (_e, beep) => callback(beep)),
})
