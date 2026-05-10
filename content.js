(() => {
  const STORAGE_KEY = 'excludeKeywords';
  const HIDDEN_CLASS = 'tlx-hidden';
  const INJECTED_ATTR = 'data-tlx-injected';
  const PAGE_COUNT_NOTE_CLASS = 'tlx-page-count-note';

  const SEARCH_BOX_SELECTORS = [
    '.list-condition',
    '.search-form',
    'form#js-search-form',
    'form.tabs-search',
    '.rstSearchHistory',
    '.search-header',
    'form[action*="/rstLst/"]',
  ];

  const RST_NAME_SELECTORS = [
    '.list-rst__rst-name-target',
    'a.list-rst__rst-name-target',
    '.list-rst__name-main',
    '.list-rst__rst-name',
    '.cpy-rst-name',
  ];

  const NEXT_PAGE_SELECTORS = [
    'a[rel="next"]',
    '.c-pagination__arrow--next > a',
    '.c-pagination__arrow--next',
    '.js-pg-next',
    '[data-page="next"] a',
    '.pagination .next a',
    'a.next',
  ];

  let currentKeywords = [];
  let observer = null;
  let saveTimer = null;
  let isNavigating = false;

  const normalize = (s) => (s || '').normalize('NFKC').toLowerCase().trim();

  const parseKeywords = (raw) =>
    (raw || '')
      .split(/[\s,、，]+/)
      .map(normalize)
      .filter(Boolean);

  const findCardContainer = (nameEl) =>
    nameEl.closest('div.list-rst, li.list-rst, li.list-rst__rst-item, li[class*="list-rst"]');

  const findFirst = (selectors, root = document) => {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  };

  const applyFilter = () => {
    document.querySelectorAll('.' + HIDDEN_CLASS).forEach((el) => el.classList.remove(HIDDEN_CLASS));

    const allCards = new Set();
    for (const sel of RST_NAME_SELECTORS) {
      document.querySelectorAll(sel).forEach((nameEl) => {
        const card = findCardContainer(nameEl);
        if (card) allCards.add(card);
      });
    }
    const total = allCards.size;

    if (currentKeywords.length === 0) {
      updateCounter(0);
      return { total, hidden: 0 };
    }

    const hiddenCards = new Set();
    for (const sel of RST_NAME_SELECTORS) {
      document.querySelectorAll(sel).forEach((nameEl) => {
        const name = normalize(nameEl.textContent);
        if (!name) return;
        if (!currentKeywords.some((kw) => name.includes(kw))) return;
        const card = findCardContainer(nameEl);
        if (card && !hiddenCards.has(card)) {
          card.classList.add(HIDDEN_CLASS);
          hiddenCards.add(card);
        }
      });
    }

    updateCounter(hiddenCards.size);
    return { total, hidden: hiddenCards.size };
  };

  const findNextPageLink = () => {
    for (const sel of NEXT_PAGE_SELECTORS) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const anchor = el.tagName === 'A' ? el : el.querySelector('a[href]');
      if (anchor && anchor.href && !anchor.href.endsWith('#')) return anchor;
    }
    return null;
  };

  const autoSkipIfAllHidden = ({ total, hidden }) => {
    if (isNavigating) return;
    if (currentKeywords.length === 0) return;
    if (total === 0) return;
    if (hidden < total) return;
    const nextLink = findNextPageLink();
    if (!nextLink) return;
    isNavigating = true;
    location.href = nextLink.href;
  };

  const updateCounter = (hidden) => {
    updatePageCountNote(hidden);
  };

  const updatePageCountNote = (hidden) => {
    document.querySelectorAll('.' + PAGE_COUNT_NOTE_CLASS).forEach((el) => el.remove());
    if (hidden === 0) return;
    const pageCount = document.querySelector('.c-page-count');
    if (!pageCount) return;
    const note = document.createElement('span');
    note.className = PAGE_COUNT_NOTE_CLASS;
    note.textContent = `（うち${hidden}件を非表示）`;
    pageCount.appendChild(note);
  };

  const buildUi = () => {
    const wrapper = document.createElement('div');
    wrapper.className = 'tlx-exclude';
    wrapper.setAttribute(INJECTED_ATTR, '1');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tlx-exclude__input';
    input.placeholder = '除外キーワード（店名）';
    input.value = (currentKeywords || []).join(' ');

    wrapper.appendChild(input);

    input.addEventListener('input', () => {
      currentKeywords = parseKeywords(input.value);
      autoSkipIfAllHidden(applyFilter());
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        chrome.storage.sync.set({ [STORAGE_KEY]: input.value });
      }, 300);
    });

    return wrapper;
  };

  const injectUi = () => {
    if (document.querySelector(`.tlx-exclude[${INJECTED_ATTR}]`)) return;

    // 検索結果ページのヘッダー
    const headerForm = document.querySelector('form.rstlst-search-header');
    if (headerForm) {
      const detail = headerForm.querySelector('.rstlst-search-header__detail');
      const btnWrap = headerForm.querySelector('.rstlst-search-header__search-button-wrap');
      const ui = buildUi();
      const insertBefore = detail || btnWrap;
      insertBefore ? headerForm.insertBefore(ui, insertBefore) : headerForm.appendChild(ui);
      return;
    }

    // トップページのヘッダー
    const topForm = document.querySelector('form.p-global-search');
    if (topForm) {
      const suggestWrap = topForm.querySelector('.p-global-search-suggest__wrap');
      const btnWrap = suggestWrap && suggestWrap.querySelector('.p-global-search__search-wrap');
      const ui = buildUi();
      if (suggestWrap && btnWrap) {
        suggestWrap.insertBefore(ui, btnWrap);
      } else if (suggestWrap) {
        suggestWrap.appendChild(ui);
      } else {
        topForm.appendChild(ui);
      }
      return;
    }

    const target = findFirst(SEARCH_BOX_SELECTORS);
    if (!target) return;
    target.appendChild(buildUi());
  };

  const runWithoutObserver = (fn) => {
    if (observer) observer.disconnect();
    try {
      fn();
    } finally {
      if (observer) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    }
  };

  const onMutations = () => {
    runWithoutObserver(() => {
      injectUi();
      autoSkipIfAllHidden(applyFilter());
    });
  };

  const start = () => {
    runWithoutObserver(() => {
      injectUi();
      autoSkipIfAllHidden(applyFilter());
    });
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, { childList: true, subtree: true });
  };

  chrome.storage.sync.get([STORAGE_KEY], (result) => {
    currentKeywords = parseKeywords(result?.[STORAGE_KEY]);
    if (document.body) {
      start();
    } else {
      window.addEventListener('DOMContentLoaded', start, { once: true });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes[STORAGE_KEY]) return;
    const newRaw = changes[STORAGE_KEY].newValue;
    currentKeywords = parseKeywords(newRaw);
    const input = document.querySelector('.tlx-exclude__input');
    if (input && input.value !== (newRaw || '')) {
      input.value = newRaw || '';
    }
    runWithoutObserver(() => {
      autoSkipIfAllHidden(applyFilter());
    });
  });
})();
