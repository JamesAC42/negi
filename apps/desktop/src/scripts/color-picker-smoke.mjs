import assert from "node:assert/strict";
// Actual settings panels, isolated browser storage, no backend or live preference writes.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const origin = process.env.MUSIC_OS_RENDERER_ORIGIN ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("http://127.0.0.1:47831/**", route => route.abort());
  await page.route(`${origin}/__color_picker_smoke`, route => route.fulfill({ contentType: "text/html", body: `<!doctype html>
    <div id="fixture"></div><script type="module">
      import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
      const React=(await import('/node_modules/.vite/deps/react.js')).default;
      const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
      const {flushSync}=(await import('/node_modules/.vite/deps/react-dom.js')).default;
      const appearance=await import('/src/renderer/appearance.ts');
      const prefs=await import('/src/renderer/now-playing-settings.ts');
      const {AppearanceStudio}=await import('/src/renderer/ui/AppearanceStudio.tsx');
      const {NowPlayingSettings}=await import('/src/renderer/ui/NowPlayingSettings.tsx');
      await import('/src/renderer/styles.css');
      window.renders=0;window.writes=0;
      const setItem=Storage.prototype.setItem;
      Storage.prototype.setItem=function(...args){window.writes++;return setItem.apply(this,args)};
      function Harness(){
        window.renders++;
        const [theme,setTheme]=React.useState(appearance.loadAppearanceSettings);
        const np=prefs.useNowPlayingSettings();
        const [visible,setVisible]=React.useState(true);
        window.theme=theme;window.np=np.settings;window.setTheme=setTheme;window.setNP=np.setSettings;window.setVisible=setVisible;
        React.useEffect(()=>localStorage.setItem(appearance.appearanceStorageKey,JSON.stringify(theme)),[theme]);
        return React.createElement('div',{className:'settingsView '+(theme.mode==='light'?'theme-light':''),style:{...appearance.getAppearanceStyle(theme),background:'var(--bg0)'}},
          visible && React.createElement(AppearanceStudio,{appearance:theme,setAppearance:setTheme,onSelectBackgroundImage:async()=>{}}),
          visible && React.createElement(NowPlayingSettings,np));
      }
      window.sync=fn=>flushSync(fn);window.accent=()=>appearance.getAppearanceStyle(window.theme)['--acc'];
      createRoot(document.querySelector('#fixture')).render(React.createElement(React.StrictMode,null,React.createElement(Harness)));
      window.ready=true;
    </script>` }));
  await page.goto(`${origin}/__color_picker_smoke`);
  await page.waitForFunction(() => window.np && window.theme);
  await page.evaluate(() => window.sync(() => window.setNP(current => ({ ...current, colorMode: 'custom' }))));
  const controls = [
    { name: 'theme', picker: 'Custom highlight color', hex: 'Custom highlight hex' },
    { name: 'player', picker: 'Choose Now Playing custom color', hex: 'Now Playing hex color' }
  ];
  const read = name => page.evaluate(name => name === 'theme' ? window.accent() : window.np.customColor, name);
  const input = async (label, value, eventType = 'input') => page.getByLabel(label, { exact: true }).evaluate((el, { value, eventType }) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event(eventType, { bubbles: true }));
  }, { value, eventType });
  const report = [];
  for (const control of controls) {
    for (const eventType of ['input', 'change']) {
      const before = await read(control.name);
      const performance = await page.getByLabel(control.picker, { exact: true }).evaluate(async (el, eventType) => {
        window.renders=0;window.writes=0;
        const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
        const start=performance.now();let final;
        for(let i=0;i<36;i++){
          final='#'+(0x123400+i*751+(eventType==='change'?0x200000:0)).toString(16).padStart(6,'0');
          setter.call(el,final);el.dispatchEvent(new Event(eventType,{bubbles:true}));
          await new Promise(resolve=>setTimeout(resolve,16));
        }
        return {renders:window.renders,writes:window.writes,elapsedMs:Math.round(performance.now()-start),final};
      }, eventType);
      assert.equal(performance.renders, 0, `${control.name} ${eventType} drag does not rerender the settings owner`);
      assert.equal(performance.writes, 0, `${control.name} ${eventType} drag does not persist each tick`);
      assert.equal(await read(control.name), before, 'applied color waits for the drag to pause');
      assert.equal(await page.getByLabel(control.hex, { exact: true }).inputValue(), performance.final, 'local hex preview follows the drag');
      await page.waitForFunction(({name,color}) => (name==='theme'?window.accent():window.np.customColor)===color, { name: control.name, color: performance.final });
      assert.equal(await page.evaluate(() => window.writes), 1, 'final color saves once after the pause');
      report.push({ control: control.name, eventType, ...performance });
    }
    const hex=page.getByLabel(control.hex,{exact:true});
    const applied=await read(control.name);
    await hex.fill('#bad');
    assert.equal(await hex.getAttribute('aria-invalid'),'true');
    await hex.blur();
    assert.equal(await read(control.name),applied,'invalid hex is never committed');
    await hex.fill('#A836E0');await hex.press('Enter');
    assert.equal(await read(control.name),'#a836e0','Enter immediately saves and normalizes valid hex');
    await input(control.picker,'#765432');
    await page.getByLabel(control.picker,{exact:true}).dispatchEvent('blur');
    // React handles native focusout for its synthetic onBlur.
    await page.getByLabel(control.picker,{exact:true}).dispatchEvent('focusout');
    assert.equal(await read(control.name),'#765432','blur flushes the latest color');
    await input(control.picker,'#445566');
    await page.evaluate(name => window.sync(() => name==='theme'
      ? window.setTheme(current=>({...current,profiles:{...current.profiles,[current.mode]:{...current.profiles[current.mode],customAccent:'#998877',accentOverride:true}}}))
      : window.setNP(current=>({...current,customColor:'#998877'}))),control.name);
    await page.waitForTimeout(200);
    assert.equal(await read(control.name),'#998877','external reset wins over a pending draft');
    assert.equal(await hex.inputValue(),'#998877','draft follows external reset');
    await input(control.picker,'#aabbcc');
    await page.evaluate(() => window.sync(() => window.setVisible(false)));
    assert.equal(await read(control.name),'#aabbcc','unmount flushes the last pending selection');
    await page.evaluate(() => window.sync(() => window.setVisible(true)));
  }
  const mode=await page.evaluate(()=>window.theme.mode);
  await input('Custom highlight color','#223344');
  await page.evaluate(() => window.sync(() => window.setTheme(current=>({...current,mode:current.mode==='dark'?'light':'dark'}))));
  assert.equal(await page.evaluate(mode=>window.theme.profiles[mode].customAccent,mode),'#223344','pending color saves to the original mode during a mode switch');
  assert.notEqual(await read('theme'),'#223344','old draft does not overwrite the other mode');
  const saved=await page.evaluate(()=>({theme:window.theme,np:window.np}));
  await page.reload();await page.waitForFunction(()=>window.np&&window.theme);
  assert.deepEqual(await page.evaluate(()=>({theme:window.theme,np:window.np})),saved,'both settings survive reload');
  for(const mode of ['dark','light']){
    await page.evaluate(mode=>window.sync(()=>window.setTheme(current=>({...current,mode}))),mode);
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    for(const selector of ['.studioCustomColor','.nowPlayingCustomColor']){
      await page.locator(selector).scrollIntoViewIfNeeded();
      const bounds=await page.locator(selector).evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,client:el.clientWidth,scroll:el.scrollWidth}));
      assert.ok(bounds.scroll<=bounds.client+1&&bounds.left>=0&&bounds.right<=width+1,`color control fits at ${width}: ${JSON.stringify(bounds)}`);
      if(process.env.MUSIC_OS_QA_DIR) await page.locator(selector).screenshot({path:process.env.MUSIC_OS_QA_DIR+'/'+selector.slice(1)+'-'+mode+'-'+width+'.png'});
    }
  }
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,drag:report,persistence:true,invalidHex:true,blur:true,unmount:true,externalReset:true,modeIsolation:true,responsive:true}));
} finally { await browser.close(); }
