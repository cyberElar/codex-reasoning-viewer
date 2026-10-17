import { readAsarMembers } from './installation.mjs';
const member = 'webview/assets/app-initial-5851df3f6cb1.js';
const start = 2814324,
  end = 2871990;
export async function managerCaptureSites(asar) {
  const files = await readAsarMembers(asar, [member]),
    source = files[member].content.toString('utf8'),
    body = source.slice(start, end);
  const patterns = [
    'getHostId(){return this.hostId}',
    'getConversation(e){return this.threadStore.getConversation(e)}',
    'onNotification(e,t,n=null,r,i=Date.now()){if(',
  ];
  return patterns.map((pattern) => {
    const index = body.indexOf(pattern);
    if (index < 0 || body.indexOf(pattern, index + 1) >= 0)
      throw new Error('Unrecognized native manager capture site');
    const offset = start + index + pattern.indexOf('{') + 1,
      before = source.slice(0, offset),
      lineNumber = before.split('\n').length - 1,
      columnNumber = offset - (before.lastIndexOf('\n') + 1);
    return { url: 'app://-/assets/app-initial-5851df3f6cb1.js', lineNumber, columnNumber };
  });
}
export async function armManagerCapture(connection, sites) {
  await connection.send('Debugger.enable');
  const ids = [];
  try {
    for (const site of sites) {
      const response = await connection.send('Debugger.setBreakpointByUrl', {
        ...site,
        condition: '(globalThis.__codexReasoningNativeAdapter?.capture(this), false)',
      });
      ids.push(response.breakpointId);
    }
  } catch (error) {
    for (const breakpointId of ids)
      await connection.send('Debugger.removeBreakpoint', { breakpointId }).catch(() => {});
    await connection.send('Debugger.disable').catch(() => {});
    throw error;
  }
  let disposed = false;
  return async () => {
    if (disposed) return;
    disposed = true;
    for (const breakpointId of ids)
      await connection.send('Debugger.removeBreakpoint', { breakpointId }).catch(() => {});
    await connection.send('Debugger.disable').catch(() => {});
  };
}
