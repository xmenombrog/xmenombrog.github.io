// Shared by index.html and spacewar.html. Loaded just inside #top so the saved (or system)
// theme is applied before the page first paints.
(() => {
  const root = document.getElementById('top');
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  let saved = null;
  try {
    saved = window.localStorage.getItem('ombrog-theme');
  } catch (e) {}

  const currentTheme = () =>
    saved === 'light' || saved === 'dark' ? saved : media && media.matches ? 'dark' : 'light';

  const applyTheme = () => {
    const isDark = currentTheme() === 'dark';
    root.className = isDark ? 't-night' : 't-day';
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';
      toggle.setAttribute('aria-label', label);
      toggle.title = label;
    }
  };

  applyTheme();
  if (media && media.addEventListener) media.addEventListener('change', applyTheme);

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme();

    document.getElementById('theme-toggle').addEventListener('click', () => {
      saved = currentTheme() === 'dark' ? 'light' : 'dark';
      try {
        window.localStorage.setItem('ombrog-theme', saved);
      } catch (e) {}
      applyTheme();
    });

    // Project filter tabs (home page only).
    const chips = document.querySelectorAll('.tab[data-filter]');
    const cards = document.querySelectorAll('#projects [data-cats]');
    const empty = document.getElementById('no-projects');
    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        const filter = chip.dataset.filter;
        let shown = 0;
        chips.forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
        cards.forEach((card) => {
          const match = filter === 'all' || card.dataset.cats.split(' ').includes(filter);
          card.hidden = !match;
          if (match) shown += 1;
        });
        if (empty) empty.hidden = shown > 0;
      });
    });
  });
})();
