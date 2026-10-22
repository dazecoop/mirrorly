const STAYS = {
  trending: [
    ['santorini', 'Cliffside villa with plunge pool', 'Oia, Santorini', 312, '4.96'],
    ['tuscany', 'Farmhouse among the cypresses', "Val d'Orcia, Italy", 226, '4.97'],
    ['hallstatt', 'Lakeside cabin under the peaks', 'Hallstatt, Austria', 189, '4.92'],
    ['bruges', 'Canal house with a garden', 'Bruges, Belgium', 148, '4.89'],
    ['bigsur', 'Treehouse above the ocean', 'Big Sur, California', 274, '4.95'],
    ['loire', 'Guest wing of a château', 'Loire Valley, France', 295, '4.88'],
    ['burano', 'Studio off the piazza', 'Procida, Italy', 132, '4.86'],
    ['brecon', 'Old mill by the falls', 'Brecon Beacons, Wales', 118, '4.91'],
  ],
  weekend: [
    ['lakes', "Shepherd's hut on the fells", 'Lake District, England', 96, '4.93'],
    ['cornwall', 'Coastal hideaway', 'St Ives, Cornwall', 165, '4.90'],
    ['forest', 'A-frame in the pines', 'Black Forest, Germany', 141, '4.94'],
    ['cotswolds', 'Barn conversion with a log burner', 'Cotswolds, England', 176, '4.87'],
  ],
};

const card = ([img, title, place, price, rating], i) => `
  <a class="card" href="#">
    <div class="pic"><img src="img/${img}.jpg" alt="">${i % 3 === 0 ? '<span class="badge">Guest favourite</span>' : ''}
      <svg class="heart" viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg></div>
    <div class="meta"><b>${title}</b><span class="rating">★ ${rating}</span></div>
    <small>${place}</small>
    <p><b>£${price}</b> night</p>
  </a>`;

for (const [id, list] of Object.entries(STAYS)) {
  document.getElementById(id).innerHTML = list.map(card).join('');
}

const PLACES = [
  ['Lake Bled', 'Slovenia'], ['Lake Como', 'Lombardy, Italy'], ['Lake District', 'Cumbria, England'],
  ['Lake Tahoe', 'California, United States'], ['Lake Louise', 'Alberta, Canada'], ['Lake Annecy', 'Haute-Savoie, France'],
  ['Lisbon', 'Portugal'], ['Lofoten', 'Norway'], ['Lucerne', 'Switzerland'], ['Santorini', 'Greece'],
];
const RECENT = [['Hallstatt', 'Austria · 12–15 Nov'], ['Cornwall', 'England · Any week'], ['Lisbon', 'Portugal · 2 guests']];

const PIN = '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>';
const CLOCK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/></svg>';
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function matches(q) {
  const t = q.trim().toLowerCase();
  return PLACES.filter(([name]) => name.toLowerCase().startsWith(t))
    .map(([name, region]) => `<li><span class="ic">${PIN}</span><span><b>${esc(name.slice(0, t.length))}</b>${esc(name.slice(t.length))}<small>${region}</small></span></li>`);
}

// The phone's search sheet.
const sheet = document.getElementById('sheet');
const q = document.getElementById('q');
const places = document.getElementById('places');
function showPlaces() {
  const found = q.value.trim() ? matches(q.value) : null;
  document.getElementById('sheet-title').textContent = found ? 'Destinations' : 'Recent searches';
  places.innerHTML = found ? found.join('') : RECENT.map(([n, r]) => `<li><span class="ic">${CLOCK}</span><span>${n}<small>${r}</small></span></li>`).join('');
}
document.getElementById('open-search').addEventListener('click', () => {
  sheet.hidden = false;
  document.body.classList.add('searching');
  showPlaces();
  q.focus();
});
document.getElementById('close-search').addEventListener('click', () => {
  sheet.hidden = true;
  document.body.classList.remove('searching');
});
q.addEventListener('input', showPlaces);

// The desktop finder's dropdown.
const where = document.getElementById('where');
const suggest = document.getElementById('where-suggest');
where.addEventListener('input', () => {
  const found = where.value.trim() ? matches(where.value) : [];
  suggest.innerHTML = found.join('');
  suggest.hidden = !found.length;
});
