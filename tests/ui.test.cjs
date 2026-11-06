const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile, mkdir } = require('node:fs/promises');
const { join } = require('node:path');
const { chromium } = require('playwright');

const root = join(__dirname, '..');
const storageKey = 'nhom_thuyet_trinh_v1';
const links = { quiz: 'https://example.com/questions', ppt: 'https://example.com/slides', mp3: 'https://example.com/audio' };
const fixture = {
  1: { stt: 1, members: ['Nguyễn Hoàng Lan', 'Trần Minh Anh', 'Lê Tuấn Kiệt', 'Phạm Ngọc Hà'], links },
  2: { stt: 2, members: ['Đặng Thanh Trúc', 'Hoàng Minh Đức', 'Vũ Phương Linh'], links },
  3: { stt: 3, members: ['Lê Nhật Nam', 'Nguyễn Thùy Dương', 'Trần Gia Huy'], links },
  4: { stt: 4, members: ['Phạm Bảo Ngọc', 'Võ Quang Huy', 'Bùi Khánh An'], links },
  5: { stt: 5, members: ['Ngô Minh Khang', 'Đỗ Hà My', 'Lý Anh Thư'], links },
};
let browser, server, origin;

before(async () => {
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname.replace(/^\/nopbai\//, '/');
    const file = { '/': 'index.html', '/styles.css': 'styles.css', '/effects.js': 'effects.js' }[pathname];
    if (!file) { res.writeHead(404).end(); return; }
    try {
      const data = await readFile(join(root, file));
      res.writeHead(200, { 'Content-Type': file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }).end(data);
    } catch { res.writeHead(500).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || undefined });
  await mkdir(join(root, 'test-results'), { recursive: true });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function open(t, { data = fixture, mode = 'local', disableWebGL = false, coarsePointer = false, path = '/', ...options } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, ...options });
  t.after(() => context.close());
  if (coarsePointer) await context.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = query => query.includes('pointer') || query.includes('hover') ? matchMedia('(width: 0px)') : matchMedia(query);
  });
  if (disableWebGL) await context.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === 'webgl2' ? null : getContext.call(this, type, ...args);
    };
  });
  await context.addInitScript(({ data, storageKey }) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(storageKey, JSON.stringify(data));
      sessionStorage.setItem('seeded', '1');
    }
    window.fixture = data;
  }, { data, storageKey });
  // Mock the SDK at the network boundary so CRUD checks never write to the class database.
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin)) return route.continue();
    if (mode !== 'local' && url.endsWith('/firebase-app.js')) {
      return route.fulfill({ contentType: 'text/javascript', body: 'export const initializeApp=()=>({});' });
    }
    if (mode !== 'local' && url.endsWith('/firebase-database.js')) {
      return route.fulfill({ contentType: 'text/javascript', body: `
        export const getDatabase=()=>({});
        export const ref=(_,path)=>path;
        export const push=()=> 'groups/new';
        export function onValue(path,receive,fail){
          window.refresh=()=>receive({forEach:fn=>Object.entries(window.fixture).forEach(([key,value])=>fn({key,val:()=>value}))});
          ${mode === 'error' ? "queueMicrotask(()=>fail(new Error('PERMISSION_DENIED')));" : mode === 'loading' ? '' : 'queueMicrotask(window.refresh);'}
        }
        export async function set(path,data){window.fixture[path.split('/').at(-1)]=data; window.refresh();}
        export async function remove(path){delete window.fixture[path.split('/').at(-1)]; window.refresh();}
      ` });
    }
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'No uncaught browser errors'));
  await page.goto(origin + path);
  if (!['loading', 'error'].includes(mode)) await page.waitForFunction(() => document.getElementById('grid').getAttribute('aria-busy') === 'false');
  return page;
}

test('Firebase groups, accurate totals, accent-insensitive search and empty results', async t => {
  const page = await open(t, { mode: 'firebase' });
  assert.equal(await page.locator('main').count(), 1);
  assert.equal(await page.locator('nav').count(), 0);
  assert.equal(await page.locator('h1').textContent(), 'Nhóm thuyết trình');
  assert.equal(await page.locator('.widget:not(.create)').count(), 5);
  assert.equal(await page.locator('#memberCount').textContent(), '16');
  assert.equal(await page.locator('#documentCount').textContent(), '15');
  assert.equal(await page.locator('#syncLabel').textContent(), 'Đã đồng bộ');
  await page.locator('#searchInput').fill('dang thanh truc');
  assert.equal(await page.locator('.widget').count(), 1);
  assert.equal(await page.locator('.w-num').textContent(), 'Nhóm 02');
  await page.locator('#searchInput').fill('không tồn tại');
  assert.equal(await page.locator('.widget').count(), 0);
  assert.equal(await page.locator('#emptyState').isVisible(), true);
  await page.locator('#searchInput').fill('');
  await page.locator('[data-stt="1"]').click();
  assert.equal(await page.locator('#dMembers li').count(), 4);
  assert.equal(await page.locator('#dQuiz').getAttribute('href'), links.quiz);
  assert.equal(await page.locator('#dPpt').getAttribute('target'), '_blank');
});

test('silk reacts to the pointer; cards tilt in both directions and reset', async t => {
  const page = await open(t, { mode: 'firebase' });
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
  assert.equal(await page.locator('#silkCanvas').evaluate(el => el.style.visibility), 'visible');
  const backgroundBefore = await page.screenshot({ clip: { x: 8, y: 160, width: 80, height: 320 } });
  const card = page.locator('[data-stt="1"]');
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width * .2, box.y + box.height * .2);
  await page.waitForFunction(() => parseFloat(document.querySelector('[data-stt="1"]').style.getPropertyValue('--tilt-x')) > 0);
  let tilt = await card.evaluate(el => [parseFloat(el.style.getPropertyValue('--tilt-x')), parseFloat(el.style.getPropertyValue('--tilt-y'))]);
  assert.ok(tilt[0] > 0 && tilt[1] < 0 && tilt.every(value => Math.abs(value) <= 9));
  await page.mouse.move(box.x + box.width * .8, box.y + box.height * .8);
  await page.waitForFunction(() => parseFloat(document.querySelector('[data-stt="1"]').style.getPropertyValue('--tilt-x')) < 0);
  tilt = await card.evaluate(el => [parseFloat(el.style.getPropertyValue('--tilt-x')), parseFloat(el.style.getPropertyValue('--tilt-y'))]);
  assert.ok(tilt[0] < 0 && tilt[1] > 0 && tilt.every(value => Math.abs(value) <= 9));
  assert.match(await card.evaluate(el => getComputedStyle(el).transform), /^matrix3d/);
  await page.screenshot({ path: join(root, 'test-results', 'pointer-tilt.png') });
  const backgroundAfter = await page.screenshot({ clip: { x: 8, y: 160, width: 80, height: 320 } });
  assert.notDeepEqual(backgroundAfter, backgroundBefore, 'Silk lighting changes with pointer movement');
  await page.mouse.move(10, 150);
  assert.equal(await card.evaluate(el => el.classList.contains('is-tilting')), false);
  assert.equal(await card.evaluate(el => el.style.getPropertyValue('--tilt-x')), '');
  await page.evaluate(() => {
    window.silkDraws = 0;
    const draw = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (...args) { window.silkDraws++; return draw.apply(this, args); };
  });
  await page.waitForTimeout(200);
  const idleDraws = await page.evaluate(() => window.silkDraws);
  assert.ok(idleDraws > 0, 'The surface has ambient animation without mouse movement');
  await page.locator('#motionToggle').click();
  const stoppedDraws = await page.evaluate(() => window.silkDraws);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.silkDraws), stoppedDraws, 'The motion toggle stops GPU drawing');
  await page.locator('#motionToggle').click();
  await page.locator('#searchInput').fill('nhom 2');
  const next = page.locator('[data-stt="2"]');
  const nextBox = await next.boundingBox();
  await page.mouse.move(nextBox.x + 60, nextBox.y + 50);
  await page.waitForFunction(() => document.querySelector('[data-stt="2"]').classList.contains('is-tilting'));
  await page.locator('#motionToggle').click();
  await page.waitForFunction(() => !document.querySelector('.is-tilting'));
  await page.mouse.move(nextBox.x + 80, nextBox.y + 70);
  assert.equal(await next.evaluate(el => el.style.getPropertyValue('--tilt-x')), '');
  const frozen = await page.screenshot({ clip: { x: 8, y: 160, width: 80, height: 320 } });
  await page.waitForTimeout(200);
  assert.deepEqual(await page.screenshot({ clip: { x: 8, y: 160, width: 80, height: 320 } }), frozen, 'The motion toggle freezes the surface');
});

test('touch and unavailable WebGL retain a usable dashboard', async t => {
  const page = await open(t, { disableWebGL: true });
  assert.equal(await page.locator('#silkCanvas').evaluate(el => el.style.visibility), 'hidden');
  await page.locator('[data-stt="1"]').click();
  assert.equal(await page.locator('#detailOverlay').evaluate(el => el.classList.contains('open')), true);
  const mobile = await open(t, { isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
  await mobile.locator('[data-stt="1"]').dispatchEvent('pointermove', { pointerType: 'touch', clientX: 100, clientY: 600 });
  assert.equal(await mobile.locator('.is-tilting').count(), 0);
  await mobile.locator('[data-stt="1"]').tap();
  assert.equal(await mobile.locator('#detailOverlay').evaluate(el => el.classList.contains('open')), true);
});

test('Windows reduced motion and a coarse primary pointer still respond to a mouse', async t => {
  const page = await open(t, { mode: 'firebase', reducedMotion: 'reduce', coarsePointer: true });
  assert.equal(await page.locator('html').getAttribute('data-motion'), 'reduced');
  assert.equal(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches), false);
  const card = page.locator('[data-stt="1"]');
  const box = await card.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.waitForFunction(() => parseFloat(document.querySelector('[data-stt="1"]').style.getPropertyValue('--tilt-y')) < 0);
  assert.ok(Math.abs(await card.evaluate(el => parseFloat(el.style.getPropertyValue('--tilt-y')))) <= 3);
  await page.locator('#motionToggle').click();
  assert.equal(await page.locator('html').getAttribute('data-motion'), 'full');
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.motion === 'full');
  await page.locator('#motionToggle').click();
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.motion === 'off');
  assert.equal(await page.locator('#motionToggle').getAttribute('aria-pressed'), 'false');
});

test('grains disperse away from the mouse and return, including without WebGL', async t => {
  for (const disableWebGL of [false, true]) {
    const page = await open(t, { mode: 'firebase', disableWebGL });
    const location = { x: 710, y: 550, radius: 40 };
    const density = () => page.evaluate(({ x, y, radius }) => {
      const canvas = document.getElementById('glitterCanvas');
      const ratio = canvas.width / canvas.clientWidth;
      const ctx = canvas.getContext('2d');
      const pixels = ctx.getImageData((x - radius) * ratio, (y - radius) * ratio, radius * 2 * ratio, radius * 2 * ratio).data;
      let bright = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 100 && pixels[i + 3] > 35) bright++;
      return bright;
    }, location);
    const before = await density();
    assert.ok(before > 5, 'Visible grains before interaction');
    await page.mouse.move(location.x, location.y);
    await page.waitForTimeout(900);
    const displaced = await density();
    assert.ok(displaced < before * .5, `The pointer clears grains: ${before} -> ${displaced}, WebGL disabled=${disableWebGL}`);
    await page.mouse.move(0, 0);
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerout', { relatedTarget: null })));
    await page.waitForTimeout(1800);
    assert.ok(await density() > before * .4, 'Grains return after the pointer leaves');
  }
});

test('versioned effects and CSS load under a GitHub Pages project path', async t => {
  const page = await open(t, { mode: 'firebase', path: '/nopbai/' });
  assert.equal(await page.locator('html').getAttribute('data-motion'), 'full');
  const assets = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => new URL(entry.name).pathname));
  assert.ok(assets.includes('/nopbai/effects.js'));
  assert.ok(assets.includes('/nopbai/styles.css'));
  assert.equal(await page.locator('.widget').first().evaluate(el => getComputedStyle(el).transformStyle), 'preserve-3d');
});

async function fillGroup(page) {
  await page.locator('#fMembers').fill('Nguyễn An\nTrần Bình');
  await page.locator('#fQuiz').fill(links.quiz);
  await page.locator('#fPpt').fill(links.ppt);
  await page.locator('#fMp3').fill(links.mp3);
}

for (const mode of ['local', 'firebase']) {
  test(`${mode}: create, edit, delete and preserve data`, async t => {
    const page = await open(t, { data: {}, mode });
    await page.locator(mode === 'local' ? '#emptyCreateBtn' : '#createGroupBtn').click();
    await fillGroup(page);
    await page.locator('#saveBtn').click();
    await page.waitForFunction(() => !document.getElementById('formOverlay').classList.contains('open'));
    assert.equal(await page.locator('.widget:not(.create)').count(), 1);
    assert.equal(await page.locator('#memberCount').textContent(), '2');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'createGroupBtn');
    if (mode === 'local') {
      await page.reload();
      await page.waitForSelector('[data-stt="1"]');
    }
    await page.locator('[data-stt="1"]').click();
    await page.locator('#dEdit').click();
    assert.equal(await page.locator('#fStt').isDisabled(), true);
    await page.locator('#fMembers').fill('Nguyễn An\nTrần Bình\nLê Chi');
    await page.locator('#saveBtn').click();
    await page.waitForFunction(() => !document.getElementById('formOverlay').classList.contains('open'));
    assert.equal(await page.locator('#memberCount').textContent(), '3');
    await page.locator('[data-stt="1"]').click();
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#dDelete').click();
    assert.equal(await page.locator('.widget:not(.create)').count(), 1);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#dDelete').click();
    await page.waitForFunction(() => !document.getElementById('detailOverlay').classList.contains('open'));
    assert.equal(await page.locator('.widget:not(.create)').count(), 0);
    if (mode === 'local') assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), '{}');
  });
}

test('keyboard focus stays in dialogs and returns to the trigger', async t => {
  const page = await open(t);
  await page.locator('[data-stt="2"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#pageContent').evaluate(el => el.inert), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'dDelete');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Đóng chi tiết');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.stt), '2');
  assert.equal(await page.locator('#pageContent').evaluate(el => el.inert), false);
  await page.locator('#createGroupBtn').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'fStt');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'createGroupBtn');
});

test('capacity, duplicate numbers and failed local saves do not change displayed data', async t => {
  const data = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [i + 1, { ...fixture[1], stt: i + 1 }]));
  const full = await open(t, { data });
  assert.equal(await full.locator('#createGroupBtn').isDisabled(), true);
  assert.equal(await full.locator('.widget.create').count(), 0);
  const page = await open(t);
  await page.locator('#createGroupBtn').click();
  await fillGroup(page);
  await page.locator('#fStt').fill('1');
  await page.locator('#saveBtn').click();
  assert.match(await page.locator('#toast').textContent(), /đã tồn tại/);
  await page.locator('#fStt').fill('6');
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); }; });
  await page.locator('#saveBtn').click();
  assert.match(await page.locator('#toast').textContent(), /Chưa lưu/);
  assert.equal(await page.locator('#formOverlay').evaluate(el => el.classList.contains('open')), true);
  assert.equal(await page.locator('#saveBtn').isDisabled(), false);
  await page.keyboard.press('Escape');
  await page.locator('#searchInput').fill('nhom');
  assert.equal(await page.locator('.widget:not(.create)').count(), 5);
});

test('loading and failed reads do not allow creating groups before data is known', async t => {
  for (const mode of ['loading', 'error']) {
    const page = await open(t, { mode });
    if (mode === 'error') await page.waitForFunction(() => document.getElementById('syncLabel').textContent === 'Chưa thể đồng bộ');
    assert.equal(await page.locator('#createGroupBtn').isDisabled(), true);
    assert.equal(await page.locator('#searchInput').isDisabled(), true);
    assert.equal(await page.locator('#emptyState').isVisible(), true);
  }
});

test('untrusted names are text and non-web document links cannot be opened', async t => {
  const page = await open(t, { data: { 1: { ...fixture[1], members: ['<img src=x onerror=alert(1)>'], links: { ...links, quiz: 'javascript:alert(1)' } }, bad: { stt: 2 } } });
  assert.equal(await page.locator('.widget:not(.create)').count(), 1);
  assert.equal(await page.locator('#grid img').count(), 0);
  await page.locator('[data-stt="1"]').click();
  assert.equal(await page.locator('#dQuiz').getAttribute('href'), null);
  assert.equal(await page.locator('#dQuiz').getAttribute('aria-disabled'), 'true');
  assert.match(await page.locator('#dMembers').textContent(), /<img/);
});

test('responsive layouts, scrollable dialogs and reduced motion', async t => {
  const page = await open(t, { mode: 'firebase', reducedMotion: 'reduce' });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width && (rect.right > innerWidth + 1 || rect.left < -1) && getComputedStyle(el).visibility !== 'hidden';
    }).map(el => el.className.baseVal ?? el.className));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No horizontal overflow at ${width}px: ${overflow.join(', ')}`);
    if ([390, 1440].includes(width)) await page.screenshot({ path: join(root, 'test-results', `${width === 390 ? 'mobile' : 'desktop'}.png`), fullPage: true });
    await page.locator('#createGroupBtn').click();
    await page.locator('#saveBtn').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#saveBtn').isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (width === 390) await page.screenshot({ path: join(root, 'test-results', 'mobile-form.png') });
    await page.keyboard.press('Escape');
  }
  assert.equal(await page.locator('.widget').first().evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.equal(await page.locator('.ambient').evaluate(el => getComputedStyle(el, '::before').animationName), 'none');
  await page.locator('[data-stt="1"]').click();
  await page.screenshot({ path: join(root, 'test-results', 'detail.png') });
});
