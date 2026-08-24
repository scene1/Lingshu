// Pre-initialization: ensure require('electron') loads built-in modules in Electron 30+
const Module = require('module');
const _resolveFilename = Module._resolveFilename;

Module._resolveFilename = function(request, parent, ...args) {
  // When running inside Electron's main process and requiring 'electron',
  // bypass npm's shim package and let Electron's built-in resolver handle it
  if (request === 'electron' && process.type === 'browser') {
    return 'electron';
  }
  return _resolveFilename.call(this, request, parent, ...args);
};
