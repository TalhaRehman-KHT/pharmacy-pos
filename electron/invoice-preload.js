// Preload for the hidden invoice windows only. CommonJS for the same reason as preload.js.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('invoice', {
  // Resolves to { ok: true, data } or { ok: false, error }, like the main window's api
  getSale: (saleId) => ipcRenderer.invoke('invoice:getSale', saleId),
  // Tells print.js the page has finished drawing: { invoiceNo, heightPx } or { error }
  rendered: (info) => ipcRenderer.send('invoice:rendered', info),
})
