/**
 * 拡張機能を実際に読み込んだ Chromium での動作テスト。
 *
 * tabelog.com へのリクエストは Playwright のルーティングで
 * test/fixtures/ の再現ページに差し替える。URL は tabelog.com のままなので
 * manifest.json の matches に従って content.js が注入される。
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const EXTENSION_DIR = path.resolve(__dirname, '..');
const PAGE_URL = 'https://tabelog.com/tokyo/A1303/A130301/rstLst/';

const readFixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const PAGE_1 = readFixture('rstlst.html');
const PAGE_2 = readFixture('rstlst-page2.html');

const ALL_NAMES = [
  '牛角 渋谷センター街店',
  '鮨 さいとう',
  'すき家 渋谷道玄坂店',
  '大衆焼肉 かるび家',
  'トラットリア ボナセーラ',
  'ＨＯＲＵＭＯＮ 焼肉ＫＩＮＧ',
];

let context;
let userDataDir;
let page;

const openPage = async () => {
  const target = await context.newPage();
  await target.route('**/*', (route) => {
    const url = route.request().url();
    if (!url.includes('tabelog.com')) return route.abort();
    const body = url.includes('/rstLst/2/') ? PAGE_2 : PAGE_1;
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });
  await target.goto(PAGE_URL);
  await target.waitForSelector('.tlx-exclude__input');
  return target;
};

const visibleNames = (target) =>
  target.$$eval('li.list-rst', (items) =>
    items
      .filter((item) => !item.classList.contains('tlx-hidden'))
      .map((item) => item.querySelector('.list-rst__rst-name-target').textContent.trim())
  );

/** キーワードを入力し、フィルタ適用と storage 保存（300ms デバウンス）を待つ */
const setKeywords = async (target, value) => {
  await target.fill('.tlx-exclude__input', value);
  await target.waitForTimeout(500);
};

before(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlx-test-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    // 拡張機能を読み込むには headless_shell ではなく完全な chromium ビルドが必要
    channel: 'chromium',
    headless: true,
    viewport: { width: 1100, height: 900 },
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
    ],
  });
  page = await openPage();
});

after(async () => {
  if (context) await context.close();
  if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
});

test('検索バーに除外キーワード入力欄を追加する', async () => {
  const ui = await page.$eval('.tlx-exclude', (el) => ({
    parent: el.parentElement.className,
    placeholder: el.querySelector('input').placeholder,
  }));
  assert.equal(ui.parent, 'rstlst-search-header');
  assert.equal(ui.placeholder, '除外キーワード（店名・ジャンル）');
});

test('キーワード未入力なら全件表示する', async () => {
  await setKeywords(page, '');
  assert.deepEqual(await visibleNames(page), ALL_NAMES);
});

test('ジャンルにキーワードを含む店を除外する', async () => {
  await setKeywords(page, '焼肉');
  assert.deepEqual(await visibleNames(page), [
    '鮨 さいとう',
    'すき家 渋谷道玄坂店',
    // ジャンルが「イタリアン、ワインバー」なので、エリア名「焼肉横丁」では除外しない
    'トラットリア ボナセーラ',
  ]);
});

test('ジャンルにのみ一致するキーワードでも除外する', async () => {
  // 「寿司」「ホルモン」はどの店名にも含まれず、ジャンル表記にだけ現れる
  await setKeywords(page, '寿司、ホルモン');
  assert.deepEqual(await visibleNames(page), [
    'すき家 渋谷道玄坂店',
    '大衆焼肉 かるび家',
    'トラットリア ボナセーラ',
  ]);
});

test('店名にキーワードを含む店を除外する', async () => {
  await setKeywords(page, 'すき家');
  assert.deepEqual(
    await visibleNames(page),
    ALL_NAMES.filter((name) => name !== 'すき家 渋谷道玄坂店')
  );
});

test('全角・大文字小文字を正規化して照合する', async () => {
  await setKeywords(page, 'horumon');
  assert.deepEqual(
    await visibleNames(page),
    ALL_NAMES.filter((name) => name !== 'ＨＯＲＵＭＯＮ 焼肉ＫＩＮＧ')
  );
});

test('非表示件数を件数表示に添える', async () => {
  await setKeywords(page, 'ホルモン');
  assert.equal(await page.$eval('.c-page-count', (el) => el.textContent.trim()), '120件（うち2件を非表示）');

  await setKeywords(page, '');
  assert.equal(await page.$$eval('.tlx-page-count-note', (els) => els.length), 0);
});

test('キーワードをクリアすると全件が再表示される', async () => {
  await setKeywords(page, '焼肉');
  assert.notDeepEqual(await visibleNames(page), ALL_NAMES);

  await setKeywords(page, '');
  assert.deepEqual(await visibleNames(page), ALL_NAMES);
});

test('キーワードを保存し、別タブでも復元して適用する', async () => {
  await setKeywords(page, 'ホルモン');

  const another = await openPage();
  try {
    await another.waitForTimeout(500);
    assert.equal(await another.$eval('.tlx-exclude__input', (el) => el.value), 'ホルモン');
    assert.deepEqual(await visibleNames(another), [
      '鮨 さいとう',
      'すき家 渋谷道玄坂店',
      '大衆焼肉 かるび家',
      'トラットリア ボナセーラ',
    ]);
  } finally {
    await another.close();
  }
  await setKeywords(page, '');
});

test('全件が非表示になったら次のページへ自動スキップする', async () => {
  const skipPage = await openPage();
  try {
    await skipPage.fill('.tlx-exclude__input', '牛角 さいとう すき家 かるび ボナセーラ king');
    await skipPage.waitForURL('**/rstLst/2/', { timeout: 10000 });
    await skipPage.waitForSelector('.tlx-exclude__input');
    await skipPage.waitForTimeout(500);
    assert.deepEqual(await visibleNames(skipPage), ['ビストロ ルミエール', '蕎麦 松風']);
  } finally {
    await skipPage.close();
  }
  await setKeywords(page, '');
});
