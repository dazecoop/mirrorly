// [name, origin, notes, price, bag colour, label colour]
const COFFEE = [
  ['Morning Ritual', 'Brazil · Medium', 'Milk chocolate, hazelnut', 11, '#d9643a', '#f6e7d4'],
  ['Fire Road', 'Ethiopia Guji · Light', 'Peach, jasmine, honey', 14, '#2f5d50', '#f3e9c9'],
  ['Night Shift', 'Espresso blend · Dark', 'Cocoa, molasses, cherry', 12, '#1f1a17', '#e8b04b'],
  ['Cold Brew Blend', 'Colombia & Peru · Coarse', 'Brown sugar, orange', 12, '#3d6fb6', '#e7f0fa'],
  ['Slow Burn Decaf', 'Colombia · Medium', 'Toffee, red apple', 12, '#8a5a9e', '#f3e6f6'],
  ['House Filter', 'Rwanda · Light', 'Black tea, plum', 13, '#c8a24a', '#2b1d14'],
];
const KIT = [['Cold Brew Kit', 'Equipment · £24'], ['Ceramic Pour-Over', 'Equipment · £22'], ['Cold brew in 12 hours, no kit needed', 'Brew guide · 5 min']];

const bag = ([name, , , , c, l], small) => `<span class="pack${small ? ' small' : ''}" style="--c:${c};--l:${l}"><span class="lbl"><b>KILN</b><em>${name}</em></span></span>`;

document.getElementById('products').innerHTML = COFFEE.slice(0, 4).map((p, i) => `
  <a class="product" href="#">
    <div class="shelf">${bag(p)}${i === 1 ? '<span class="tag">New harvest</span>' : ''}</div>
    <b>${p[0]}</b><small>${p[1]}</small><span class="notes">${p[2]}</span>
    <span class="price">£${p[3]}.00 <em>250g</em></span>
  </a>`).join('');

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const mark = (text, q) => {
  const i = text.toLowerCase().indexOf(q);
  return i < 0 ? esc(text) : `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
};

function results(raw) {
  const q = raw.trim().toLowerCase();
  if (!q) {
    return `<h4>Popular searches</h4><div class="pills"><span>Decaf</span><span>Espresso</span><span>Subscriptions</span><span>Gift cards</span><span>Grinders</span></div>
      <h4>Bestsellers</h4>${COFFEE.slice(0, 3).map((p) => `<div class="hit">${bag(p, true)}<span><b>${p[0]}</b><small>${p[1]} · £${p[3]}</small></span></div>`).join('')}`;
  }
  const coffee = COFFEE.filter((p) => `${p[0]} ${p[2]}`.toLowerCase().includes(q));
  const kit = KIT.filter(([n]) => n.toLowerCase().includes(q));
  const words = ['cold brew', 'cold brew kit', 'cold brew concentrate', 'decaf', 'espresso'].filter((w) => w.startsWith(q));
  return `${words.map((w) => `<div class="word"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg><span>${mark(w, q)}</span></div>`).join('')}
    ${coffee.length ? '<h4>Coffee</h4>' : ''}${coffee.map((p) => `<div class="hit">${bag(p, true)}<span><b>${mark(p[0], q)}</b><small>${p[1]} · £${p[3]}</small></span></div>`).join('')}
    ${kit.length ? '<h4>Kit & guides</h4>' : ''}${kit.map(([n, s]) => `<div class="hit"><span class="kit"></span><span><b>${mark(n, q)}</b><small>${s}</small></span></div>`).join('')}`;
}

const sheet = document.getElementById('sheet');
const q = document.getElementById('q');
const body = document.getElementById('sheet-body');
document.getElementById('open-search').addEventListener('click', () => {
  sheet.hidden = false;
  document.body.classList.add('searching');
  body.innerHTML = results(q.value);
  q.focus();
});
document.getElementById('close-search').addEventListener('click', () => {
  sheet.hidden = true;
  document.body.classList.remove('searching');
});
q.addEventListener('input', () => { body.innerHTML = results(q.value); });

const dq = document.getElementById('desk-q');
const dr = document.getElementById('desk-results');
dq.addEventListener('input', () => {
  dr.innerHTML = dq.value.trim() ? results(dq.value) : '';
  dr.hidden = !dq.value.trim();
});
