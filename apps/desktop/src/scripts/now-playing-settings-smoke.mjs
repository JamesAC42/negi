import assert from 'node:assert/strict';
// Actual settings, persistence hook, modal and CSS; every backend/artwork request is isolated.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const origin = process.env.MUSIC_OS_RENDERER_ORIGIN ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless:true, args:['--no-sandbox','--disable-features=LocalNetworkAccessChecks'] });
try {
  const page = await browser.newPage({viewport:{width:1720,height:1100},reducedMotion:'reduce'});
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.route('**/src/renderer/ui/App.tsx*', async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:await response.text()+'\nexport { getCanvasThemeColors };'});
  });
  await page.route('http://127.0.0.1:47831/**', route=>{
    if(new URL(route.request().url()).pathname.startsWith('/artwork/file/')) return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="#dd2222" d="M0 0h32v32H0z"/></svg>'});
    return route.fulfill({status:404,contentType:'application/json',body:'{}'});
  });
  await page.route(`${origin}/__now_playing_settings_smoke`,route=>route.fulfill({contentType:'text/html',body:`<!doctype html>
    <div id="fixture" style="--acc:#42b7da"></div><script type="module">
      import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
      const React=(await import('/node_modules/.vite/deps/react.js')).default;
      const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
      const {flushSync}=(await import('/node_modules/.vite/deps/react-dom.js')).default;
      // Screenshot readiness must follow WebGL drawing, not just CSS resizing.
      for(const Type of [window.WebGLRenderingContext,window.WebGL2RenderingContext].filter(Boolean)){
        for(const name of ['drawElements','drawArrays']){
          const original=Type.prototype[name];
          Type.prototype[name]=function(...args){const result=original.apply(this,args);this.canvas.dataset.qaDrawnSize=this.canvas.width+'x'+this.canvas.height;return result};
        }
      }
      const api=await import('/src/renderer/ui/App.tsx');
      const prefs=await import('/src/renderer/now-playing-settings.ts');
      const {NowPlayingSettings}=await import('/src/renderer/ui/NowPlayingSettings.tsx');
      await import('/src/renderer/styles.css');
      window.appearance=await import('/src/renderer/appearance.ts');
      window.prefs=prefs;window.api=api;window.view='settings';window.themeAccent='#42b7da';
      window.files=[{id:'red',path:'/fixture/red.flac',filename:'red.flac',extension:'flac',sizeBytes:1024,durationMs:180000,
        displayTags:{title:'Fixture song',artist:'Fixture artist',album:'Fixture album',tracknumber:'1'},
        tags:{},rating:null,favoriteStatus:'neutral',playCount:0,lastPlayedAt:null}];
      window.playback={status:'paused',currentFileId:null,currentDisplayName:null,queue:[],queueIndex:null,repeatMode:'none',positionMs:0,durationMs:180000,volume:80};
      const noop=async()=>{};const frameRef={current:null};const root=createRoot(document.querySelector('#fixture'));
      function Harness(){
        const state=prefs.useNowPlayingSettings();window.settings=state.settings;window.setSettings=state.setSettings;
        return window.view==='settings'?React.createElement('div',{className:'settingsView'},React.createElement(NowPlayingSettings,state)):React.createElement(api.NowPlayingModal,{
          settings:state.settings,themeAccent:window.themeAccent,appearanceMode:'dark',files:window.files,playback:window.playback,playbackBusy:false,
          onRecordPlayerAction:noop,onRecordPlayerPresence:noop,onStop:noop,onClose:noop,onFavoriteStatus:noop,
          onNext:noop,onPauseResume:noop,onPlayFile:noop,onPrevious:noop,onRating:noop,onReplaceUpNext:noop,
          onRepeatMode:noop,onSaveQueue:noop,onSeek:noop,onOpenAlbumPage:noop,onOpenArtistPage:noop,onVolumeChange:noop,
          visualizerFrameRef:frameRef,waveformState:{status:'idle',waveform:null,message:null}});
      }
      window.render=()=>flushSync(()=>root.render(React.createElement(Harness)));
      window.patch=change=>flushSync(()=>window.setSettings(current=>({...current,...change})));
      window.show=view=>{window.view=view;window.render()};
      window.color=()=>getComputedStyle(document.querySelector('.nowPlayingOverlay')).getPropertyValue('--acc').trim();
      window.layout=()=>{
        const rect=selector=>{const r=document.querySelector(selector)?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}:null};
        const style=getComputedStyle(document.querySelector('.nowPlayingCockpit'));return {viewportWidth:innerWidth,scrollHeight:document.querySelector('.nowPlayingCockpit').scrollHeight,clientHeight:document.querySelector('.nowPlayingCockpit').clientHeight,paddingTop:parseFloat(style.paddingTop),paddingLeft:style.paddingLeft,paddingRight:style.paddingRight,left:style.getPropertyValue('--visualizer-left-gutter'),data:document.querySelector('.nowPlayingOverlay').dataset.leftMeter,waveform:rect('.waveformRibbon'),floor:rect('.spectrogramFloor'),art:rect('.nowPlayingArtShell'),controls:rect('.nowPlayingControlDeck'),focus:rect('.nowPlayingFocus'),cockpit:rect('.nowPlayingCockpit'),info:rect('.nowPlayingModalInfo'),queue:rect('.nowPlayingQueue'),right:rect('.nowPlayingRightColumn'),spectrum:rect('.focusSpectrum'),spectrumMaxHeight:parseFloat(getComputedStyle(document.querySelector('.nowPlayingRightColumn')).getPropertyValue('--np-spectrum-max-height')),paddingBottom:parseFloat(getComputedStyle(document.querySelector('.nowPlayingCockpit')).paddingBottom)};
      };window.render();window.ready=true;
    </script>`}));
  await page.goto(`${origin}/__now_playing_settings_smoke`);
  await page.waitForFunction(()=>window.ready);
  const normalized=await page.evaluate(()=>({
    malformed:window.prefs.normalizeNowPlayingSettings({leftMeter:false,rightMeter:'false',customColor:'#XYZ123',colorMode:'unknown'}),
    unavailable:window.prefs.loadNowPlayingSettings({getItem(){throw Error('blocked')}}),defaults:window.prefs.defaultNowPlayingSettings}));
  assert.equal(normalized.malformed.leftMeter,false);
  assert.equal(normalized.malformed.rightMeter,true);
  assert.equal(normalized.malformed.customColor,normalized.defaults.customColor);
  assert.equal(normalized.malformed.colorMode,'artwork');
  assert.deepEqual(normalized.unavailable,normalized.defaults,'unavailable storage falls back safely');
  const toggles=[['leftMeter','Left meter','.meterRail.left'],['rightMeter','Right meter','.meterRail.right'],['spectrogram','Spectrogram','.spectrogramFloor'],['waveform','Waveform','.waveformRibbon'],['liveSpectrum','Live spectrum','.focusSpectrum']];
  for(const [,label] of toggles) await page.getByRole('switch',{name:label,exact:true}).uncheck();
  await page.getByRole('button',{name:'Now Playing color source',exact:true}).click();
  await page.getByRole('option',{name:'Custom color',exact:true}).click();
  const hex=page.getByRole('textbox',{name:'Now Playing hex color'});
  await hex.fill('#bad');
  assert.equal(await hex.getAttribute('aria-invalid'),'true');
  assert.equal(await page.evaluate(()=>window.settings.customColor),normalized.defaults.customColor,'partial input does not change applied color');
  await hex.fill('#a836e0');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('music-os:now-playing:v1')).customColor==='#a836e0');
  await page.reload();await page.waitForFunction(()=>window.ready);
  for(const [,label] of toggles) assert.equal(await page.getByRole('switch',{name:label,exact:true}).isChecked(),false,`${label} survives reload`);
  assert.equal(await page.getByRole('textbox',{name:'Now Playing hex color'}).inputValue(),'#a836e0');
  if(process.env.MUSIC_OS_QA_DIR) await page.screenshot({path:process.env.MUSIC_OS_QA_DIR+'/settings.png',fullPage:true});
  await page.evaluate(()=>window.show('modal'));
  assert.equal(await page.evaluate(()=>window.color()),'#a836e0','custom accent reaches modal');
  for(const [,,selector] of toggles) assert.equal(await page.locator(selector).count(),0,`${selector} unmounts when disabled`);
  assert.ok(await page.locator('.modalProgressSeek').count(),'seeking remains available without waveform');
  await page.evaluate(()=>window.patch({...window.prefs.defaultNowPlayingSettings,colorMode:'theme'}));
  assert.equal(await page.evaluate(()=>window.color()),'#42b7da','theme mode inherits current accent');
  const colors=await page.evaluate(()=>{
    const canvas=document.querySelector('.heroWaveformCanvas');const before=window.api.getCanvasThemeColors(canvas).accent;
    window.patch({colorMode:'custom',customColor:'#a836e0'});return {before,after:window.api.getCanvasThemeColors(canvas).accent};
  });
  assert.notDeepEqual(colors.before,colors.after,'paused canvas color invalidates immediately');
  await page.evaluate(()=>{
    window.playback={...window.playback,currentFileId:'red',currentDisplayName:'Fixture song',queue:['red'],queueIndex:0};
    window.patch({colorMode:'artwork'});window.render();
  });
  await page.waitForFunction(()=>{
    const accent=document.querySelector('.nowPlayingOverlay').style.getPropertyValue('--acc');
    return accent&&accent!=='#a836e0'&&accent!=='#42b7da';
  });
  const artworkAccent=await page.evaluate(()=>window.color());
  await page.evaluate(()=>window.patch({colorMode:'theme'}));
  assert.equal(await page.evaluate(()=>window.color()),'#42b7da','theme mode clears extracted album color');
  const settle=()=>page.evaluate(async()=>{
    document.body.getBoundingClientRect();
    await Promise.all(document.getAnimations().filter(a=>a instanceof CSSTransition).map(a=>a.finished.catch(()=>{})));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
  const recordReady=async()=>{
    await page.waitForFunction(()=>{
      const canvas=document.querySelector('.turntableScene canvas');
      return canvas&&canvas.width>0&&canvas.height>0&&canvas.dataset.qaDrawnSize===canvas.width+'x'+canvas.height;
    });
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  };
  const assertCenteredStack=(layout)=>{
    for(const row of [layout.controls,layout.waveform,layout.floor].filter(row=>row?.height)) {
      assert.ok(Math.abs(row.x-layout.focus.x)<2&&Math.abs(row.width-layout.focus.width)<2,'all center rows share the same horizontal edges');
    }
    assert.ok(Math.abs(layout.art.x-layout.focus.x)<2,'artwork aligns with the row left edge');
    assert.ok(Math.abs(layout.right.x+layout.right.width-layout.focus.x-layout.focus.width)<2,'song info aligns with the row right edge');
    const top=layout.waveform?.height ? layout.waveform.y : layout.focus.y;
    const bottom=layout.floor?.height ? layout.floor.bottom : layout.focus.bottom;
    const available=layout.cockpit.height-layout.paddingTop-layout.paddingBottom;
    if(bottom-top<=available+1) assert.ok(Math.abs((top+bottom)/2-(layout.cockpit.y+layout.paddingTop+available/2))<2,'player stack is vertically centered');
    if(layout.viewportWidth>980) {
      assert.ok(layout.scrollHeight<=layout.clientHeight+1,'desktop cockpit has no scrollable overflow: '+JSON.stringify(layout));
      assert.ok(top>=layout.cockpit.y+layout.paddingTop-2&&bottom<=layout.cockpit.bottom-layout.paddingBottom+2,'all content fits inside the window without clipping');
      if(layout.spectrum) assert.ok(layout.spectrum.y>=layout.info.bottom-1,'shrinking spectrum never overlaps song info');
    }
    const controlsGap=layout.controls.y-Math.max(layout.art.bottom,layout.right.bottom);
    assert.ok(controlsGap>=-1&&controlsGap<=40,'controls stay close to artwork and song info: '+controlsGap);
    if(layout.waveform?.height) assert.ok(layout.focus.y-layout.waveform.bottom<=20,'waveform stays next to the main player');
    if(layout.floor?.height) assert.ok(layout.floor.y-layout.focus.bottom<=20,'spectrogram stays next to the controls');
  };
  const report=[];
  for(const viewport of [{width:1720,height:1800},{width:1720,height:1100},{width:1440,height:800},{width:1440,height:720},{width:1280,height:720},{width:1920,height:1080},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    await page.evaluate(()=>window.patch({...window.prefs.defaultNowPlayingSettings,colorMode:'theme'}));
    await settle();
    const baseline=await page.evaluate(()=>window.layout());
    assertCenteredStack(baseline);
    if(viewport.width>980) {
      await page.evaluate(()=>{window.files=window.files.map(file=>({...file,displayTags:{...file.displayTags,title:'Kemono Friends Mega Mashup Medley!'}}));window.render();});
      await settle();
      assertCenteredStack(await page.evaluate(()=>window.layout()));
      await page.evaluate(()=>{window.files=window.files.map(file=>({...file,displayTags:{...file.displayTags,title:'Fixture song'}}));window.render();});
      await settle();
    }
    assert.ok(baseline.spectrum.height>=(viewport.width>980 ? 64 : 190)-1,'live spectrum stays usable while fitting the window');
    assert.ok(baseline.spectrum.height<=baseline.info.height*1.5+2,'spectrum never exceeds 1.5 times the info card');
    if(viewport.height===1800) {
      assert.ok(Math.abs(baseline.spectrumMaxHeight-baseline.info.height*1.5)<2,'spectrum retains its relative height cap');
      await page.evaluate(()=>{
        window.files=window.files.map(file=>({...file,displayTags:{...file.displayTags,title:'A much longer song title that wraps across several lines in the song information card'}}));
        window.render();
      });
      await settle();
      const wrapped=await page.evaluate(()=>window.layout());
      assert.ok(wrapped.info.height>baseline.info.height,'wrapped metadata increases intrinsic card height');
      assert.ok(Math.abs(wrapped.spectrumMaxHeight-wrapped.info.height*1.5)<2,'spectrum cap follows changed card height');
      assert.ok(wrapped.spectrum.height<=wrapped.spectrumMaxHeight+2,'spectrum may shrink below its cap when space is limited');
      await page.evaluate(()=>{window.files=window.files.map(file=>({...file,displayTags:{...file.displayTags,title:'Fixture song'}}));window.render();});
      await settle();
    }
    await recordReady();
    if(process.env.MUSIC_OS_QA_DIR) await page.screenshot({path:process.env.MUSIC_OS_QA_DIR+`/enabled-${viewport.width}x${viewport.height}.png`,fullPage:true});
    for(const [key,,selector] of toggles){
      await page.evaluate(key=>window.patch({[key]:false}),key);
      assert.equal(await page.locator(selector).count(),0,`${key} independently unmounts at ${viewport.width}`);
      await settle();
      const changed=await page.evaluate(()=>window.layout());
      assertCenteredStack(changed);
      if(viewport.width>980&&(key==='leftMeter'||key==='rightMeter')) assert.ok(Math.abs(changed.focus.width-baseline.focus.width)<2,`${key} preserves the compact content width`);
      if(key==='waveform') assert.ok(changed.focus.y<baseline.focus.y-20,`waveform returns vertical space at ${viewport.width}`);
      if(key==='spectrogram') assert.ok(changed.info.height<=baseline.info.height+2,'hiding the floor keeps info content-sized');

      if(key==='liveSpectrum') assert.ok(Math.abs(changed.info.height-baseline.info.height)<2,'info card keeps its content height without the spectrum');
      await page.evaluate(key=>window.patch({[key]:true}),key);
      await settle();
    }
    await page.evaluate(()=>window.patch({leftMeter:false,rightMeter:false,spectrogram:false,waveform:false,liveSpectrum:false}));
    await settle();
    const empty=await page.evaluate(()=>window.layout());
    assertCenteredStack(empty);
    assert.ok(Math.abs(empty.focus.width-baseline.focus.width)<2,'removing both meters does not widen the middle content');
    if(viewport.height===1800) assert.ok(empty.info.height<empty.cockpit.height/2,'all-off info does not stretch into the remaining window height');
    assert.ok(await page.locator('.nowPlayingControlDeck').isVisible(),'controls remain visible');
    await recordReady();
    if(process.env.MUSIC_OS_QA_DIR) await page.screenshot({path:process.env.MUSIC_OS_QA_DIR+`/disabled-${viewport.width}x${viewport.height}.png`,fullPage:true});
    if(process.env.MUSIC_OS_QA_DIR){
      await page.screenshot({path:process.env.MUSIC_OS_QA_DIR+`/disabled-${viewport.width}x${viewport.height}.jpg`,quality:70,fullPage:true});
      if(viewport.width<=980){
        await page.locator('.nowPlayingControlDeck').scrollIntoViewIfNeeded();
        await page.screenshot({path:process.env.MUSIC_OS_QA_DIR+'/disabled-mobile-controls.jpg',quality:70,fullPage:true});
      }
    }
    report.push({viewport,baseline:baseline.focus,allOff:empty.focus,infoHeight:baseline.info.height,spectrumHeight:baseline.spectrum.height,allOffInfoHeight:empty.info.height});
  }
  await page.evaluate(()=>{window.show('settings');window.patch({colorMode:'custom'});});
  if(process.env.MUSIC_OS_QA_DIR) await page.screenshot({path:process.env.MUSIC_OS_QA_DIR+'/settings-compact.png',fullPage:true});
  const light=await page.evaluate(()=>{
    const fixture=document.querySelector('#fixture');fixture.classList.add('theme-light');
    const theme=window.appearance.getAppearanceStyle({...window.appearance.defaultAppearanceSettings(),mode:'light'});
    for(const [key,value] of Object.entries(theme)) key.startsWith('--')?fixture.style.setProperty(key,value):fixture.style[key]=value;
    return theme['--acc'];
  });
  await page.getByRole('switch',{name:'Left meter',exact:true}).check();
  assert.equal(await page.getByRole('switch',{name:'Left meter',exact:true}).isChecked(),true,'light theme switches remain interactive');
  if(process.env.MUSIC_OS_QA_DIR) await page.screenshot({path:process.env.MUSIC_OS_QA_DIR+'/settings-light-compact.png',fullPage:true});
  await page.evaluate(()=>{window.patch({colorMode:'theme'});window.show('modal');});
  assert.equal(await page.evaluate(()=>window.color()),light,'theme mode inherits light appearance accent');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,persistence:true,independentVisualizers:true,artworkAccent,layouts:report}));
}finally{await browser.close();}
