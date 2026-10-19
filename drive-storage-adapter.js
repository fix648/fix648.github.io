/* N326: test-only Drive adapter. No production Notes CRUD, no credentials in frontend. */
(() => {
  'use strict';
  const endpoint = 'https://oiaudmzrwtaljkcwbooi.supabase.co/functions/v1/portal-drive-storage';
  const actions = new Set(['ping', 'create_test', 'read_test']);
  async function request(action) {
    if (!actions.has(action)) throw new Error('Unsupported test action');
    if (typeof client === 'undefined') throw new Error('Supabase client unavailable');
    const {data, error} = await client.auth.getSession();
    if (error || !data?.session?.access_token) throw new Error('Please sign in to Personal Portal first');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {'Authorization': 'Bearer ' + data.session.access_token,
                'apikey': SUPABASE_PUBLISHABLE_KEY,
                'Content-Type': 'application/json'},
      body: JSON.stringify({action}),
      cache: 'no-store'
    });
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error('API returned non-JSON response (HTTP ' + response.status + ')'); }
    if (!response.ok || payload.ok !== true) throw new Error(action + ': HTTP ' + response.status + ' / ' + String(payload.code || 'UNKNOWN'));
    return {action, status: response.status, code: payload.code || 'OK', contentVerified: payload.contentVerified === true};
  }
  async function run(actionsToRun) {
    const status = document.getElementById('driveAdapterStatus');
    const buttons = [document.getElementById('drivePingBtn'), document.getElementById('driveThreeTestsBtn')];
    buttons.forEach(b => {if(b) b.disabled=true;});
    const results=[];
    try {
      for(const action of actionsToRun) {
        status.textContent = 'Checking: ' + action + '…';
        results.push(await request(action));
      }
      if (actionsToRun.includes('read_test') && !results.find(x=>x.action==='read_test')?.contentVerified) throw new Error('Read test did not verify content');
      status.textContent = 'PASS — ' + results.map(x=>x.action + ': ' + x.code).join(' | ');
    } catch(e) {status.textContent = 'FAIL — ' + String(e.message || e);}
    finally {buttons.forEach(b=>{if(b)b.disabled=false;});}
  }
  document.getElementById('drivePingBtn')?.addEventListener('click',()=>run(['ping']));
  document.getElementById('driveThreeTestsBtn')?.addEventListener('click',()=>run(['ping','create_test','read_test']));
  Object.defineProperty(window,'PortalDriveAdapter',{value:Object.freeze({ping:()=>request('ping')}),writable:false});
})();
