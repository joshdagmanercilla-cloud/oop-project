// REPLACE THIS WITH YOUR ACTUAL RENDER BACKEND URL:
const API_BASE = 'https://your-render-app-name.onrender.com';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const currency = amount => `₱${Number(amount || 0).toLocaleString('en-PH')}`;
const manilaDate = (value, options) => new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', ...options });
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const saved = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const placeholderImage = 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80';

const app = {
  menu: [], menuLoaded: false, category: 'All', search: '', cart: saved('hh_cart', []), orders: saved('hh_orders', []), admin: null,
  adminOrders: [], guests: [], currentAdminView: 'overview', polling: null, guestPolling: null, pendingCheckoutOrder: null,
};

async function api(url, options = {}) {
  const targetUrl = url.startsWith('/api') ? `${API_BASE}${url}` : url;
  const response = await fetch(targetUrl, {
    credentials: 'omit', // Changed to omit for cross-origin requests from GitHub Pages to Render
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) {
    if (response.status === 401 && url.startsWith('/api/admin/') && url !== '/api/admin/login') setAdmin(null);
    throw new Error(payload.error || 'Something went wrong. Please try again.');
  }
  return payload;
}

function toast(message, error = false) {
  const node = document.createElement('div');
  node.className = `toast${error ? ' is-error' : ''}`;
  node.innerHTML = `<i class="fa-solid ${error ? 'fa-circle-exclamation' : 'fa-circle-check'}" aria-hidden="true"></i><span>${escapeHtml(message)}</span>`;
  $('#toast-region').append(node);
  setTimeout(() => node.remove(), 3600);
}

function setView(name) {
  const view = document.getElementById(`${name}-view`) ? name : 'home';
  $$('.view').forEach(section => section.classList.toggle('active-view', section.id === `${view}-view`));
  $$('[data-view-link]').forEach(link => link.classList.toggle('active', link.dataset.viewLink === view));
  const mainNav = $('.main-nav');
  if (mainNav) mainNav.classList.remove('is-open');
  const mobileMenuBtn = $('#mobile-menu-button');
  if (mobileMenuBtn) {
    mobileMenuBtn.setAttribute('aria-expanded', 'false');
    mobileMenuBtn.innerHTML = '<i class="fa-solid fa-bars" aria-hidden="true"></i>';
  }
  if (view === 'menu') renderMenu();
  if (view === 'orders') { renderGuestOrders(); refreshGuestOrders(); }
  if (view === 'admin' && app.admin) showAdminApp();
  if (view === 'home') renderFeatured();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function routeFromHash() {
  const route = location.hash.replace(/^#/, '') || 'home';
  const known = ['home', 'menu', 'orders', 'about', 'contact', 'admin'];
  setView(known.includes(route) ? route : 'home');
  if (route === 'admin') checkSession();
}

function renderFoodCard(item) {
  const availability = Number(item.available) === 1 || item.available === true;
  return `<article class="food-card">
    <div class="food-image-wrap"><img class="food-image" src="${escapeHtml(item.imageUrl || placeholderImage)}" alt="${escapeHtml(item.name)}" loading="lazy" onerror="this.src='${placeholderImage}'"><span class="food-category">${escapeHtml(item.category)}</span>${availability ? '' : '<span class="food-unavailable">Currently unavailable</span>'}</div>
    <div class="food-info"><div class="food-info-top"><h3>${escapeHtml(item.name)}</h3><span class="food-price">${currency(item.price)}</span></div><p class="food-description">${escapeHtml(item.description)}</p><button class="add-button" data-add-item="${Number(item.id)}" ${availability ? '' : 'disabled'}><i class="fa-solid fa-plus" aria-hidden="true"></i>${availability ? 'Add to bag' : 'Not available'}</button></div>
  </article>`;
}

function renderFeatured() {
  const featuredGrid = $('#featured-grid');
  if (!featuredGrid) return;
  featuredGrid.innerHTML = app.menu.filter(item => item.featured && item.available).slice(0, 3).map(renderFoodCard).join('') || app.menu.filter(item => item.available).slice(0, 3).map(renderFoodCard).join('');
}

function renderMenu() {
  const query = app.search.toLowerCase();
  const items = app.menu.filter(item => (app.category === 'All' || item.category === app.category) && (!query || `${item.name} ${item.description} ${item.category}`.toLowerCase().includes(query)));
  $$('.category-tab').forEach(button => button.classList.toggle('active', button.dataset.category === app.category));
  const allCount = $('#all-count');
  if (allCount) allCount.textContent = String(app.menu.length);
  const resultsCount = $('#menu-results-count');
  if (resultsCount) resultsCount.textContent = `${items.length} ${items.length === 1 ? 'dish' : 'dishes'} to choose from`;
  const menuGrid = $('#menu-grid');
  if (menuGrid) menuGrid.innerHTML = items.length ? items.map(renderFoodCard).join('') : '<div class="empty-results">Nothing on the menu matches that just yet.</div>';
}

async function loadMenu() {
  try {
    app.menu = await api('/api/menu');
    app.menuLoaded = true;
    renderFeatured();
    renderMenu();
    renderCart();
    if (app.admin) renderAdminMenu();
  } catch (error) { toast(error.message, true); }
}

function persistCart() { save('hh_cart', app.cart); updateCartCount(); }
function cartQuantity() { return app.cart.reduce((sum, item) => sum + item.quantity, 0); }
function cartTotal() {
  return app.cart.reduce((sum, cartItem) => sum + (app.menu.find(item => item.id === cartItem.id)?.price || 0) * cartItem.quantity, 0);
}

function addToCart(id) {
  const item = app.menu.find(product => product.id === id);
  if (!item || !item.available) return toast('That dish is not available right now.', true);
  const line = app.cart.find(product => product.id === id);
  if (line) line.quantity = Math.min(line.quantity + 1, 20);
  else app.cart.push({ id, quantity: 1 });
  persistCart(); renderCart(); toast(`${item.name} added to your bag.`);
}

function updateCartCount() {
  const cartCount = $('#cart-count');
  if (cartCount) cartCount.textContent = String(cartQuantity());
}

function renderCart() {
  const cartItemsContainer = $('#cart-items');
  const cartSubtotal = $('#cart-subtotal');
  const checkoutButton = $('#checkout-button');
  if (!cartItemsContainer) return;

  if (!app.menuLoaded) {
    updateCartCount();
    cartItemsContainer.innerHTML = '<div class="cart-empty"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><h3>Loading the menu.</h3><p>Your saved bag will appear in a moment.</p></div>';
    if (cartSubtotal) cartSubtotal.textContent = currency(0);
    if (checkoutButton) checkoutButton.disabled = true;
    return;
  }
  app.cart = app.cart.filter(line => app.menu.some(item => item.id === line.id && item.available));
  persistCart();
  const lines = app.cart.map(line => {
    const item = app.menu.find(product => product.id === line.id);
    if (!item) return '';
    return `<div class="cart-line"><div><h3>${escapeHtml(item.name)}</h3><span class="cart-line-price">${currency(item.price)} each</span><div class="quantity-controls"><button data-cart-action="decrease" data-id="${item.id}" aria-label="Decrease ${escapeHtml(item.name)} quantity"><i class="fa-solid fa-minus" aria-hidden="true"></i></button><span>${line.quantity}</span><button data-cart-action="increase" data-id="${item.id}" aria-label="Increase ${escapeHtml(item.name)} quantity"><i class="fa-solid fa-plus" aria-hidden="true"></i></button><button class="cart-remove" data-cart-action="remove" data-id="${item.id}" aria-label="Remove ${escapeHtml(item.name)}"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button></div></div><span class="cart-line-total">${currency(item.price * line.quantity)}</span></div>`;
  }).join('');
  cartItemsContainer.innerHTML = lines || '<div class="cart-empty"><i class="fa-solid fa-bag-shopping" aria-hidden="true"></i><h3>A little room in here.</h3><p>Your bag is waiting for something good from the kitchen.</p></div>';
  if (cartSubtotal) cartSubtotal.textContent = currency(cartTotal());
  if (checkoutButton) checkoutButton.disabled = !app.cart.length;
}

function changeCart(id, action) {
  const line = app.cart.find(item => item.id === id);
  if (!line) return;
  if (action === 'increase') line.quantity = Math.min(20, line.quantity + 1);
  if (action === 'decrease') line.quantity -= 1;
  if (action === 'remove' || line.quantity < 1) app.cart = app.cart.filter(item => item.id !== id);
  persistCart(); renderCart();
}

function openCart() {
  renderCart();
  $('#cart-scrim')?.classList.add('is-open');
  const drawer = $('#cart-drawer');
  if (drawer) {
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
  }
  document.body.style.overflow = 'hidden';
}

function closeCart() {
  $('#cart-scrim')?.classList.remove('is-open');
  const drawer = $('#cart-drawer');
  if (drawer) {
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
  }
  document.body.style.overflow = '';
}

function openCheckout() {
  if (!app.cart.length) return;
  const cartRoom = $('#cart-room');
  const room = cartRoom ? cartRoom.value.trim() : '';
  if (!room) { cartRoom?.focus(); return toast('Add your room number to continue.', true); }
  const guestRoom = $('#guest-room');
  if (guestRoom) guestRoom.value = room;
  const checkoutItems = $('#checkout-items');
  if (checkoutItems) {
    checkoutItems.innerHTML = app.cart.map(line => {
      const item = app.menu.find(product => product.id === line.id);
      return `<div class="checkout-summary-line"><span>${line.quantity} × ${escapeHtml(item.name)}</span><strong>${currency(item.price * line.quantity)}</strong></div>`;
    }).join('');
  }
  const checkoutTotal = $('#checkout-total');
  if (checkoutTotal) checkoutTotal.textContent = currency(cartTotal());
  const checkoutError = $('#checkout-error');
  if (checkoutError) checkoutError.textContent = '';
  $('#checkout-scrim')?.classList.add('is-open');
  closeCart();
  $('#guest-name')?.focus();
}

function closeCheckout() { $('#checkout-scrim')?.classList.remove('is-open'); }

async function placeOrder(event) {
  event.preventDefault();
  const button = $('#place-order-button');
  const checkoutForm = $('#checkout-form');
  if (checkoutForm && !checkoutForm.reportValidity()) return;
  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Saving your order…';
  }
  const checkoutError = $('#checkout-error');
  if (checkoutError) checkoutError.textContent = '';
  const form = new FormData(event.currentTarget);
  try {
    const order = await api('/api/orders', { method: 'POST', body: JSON.stringify({
      guestName: form.get('guestName'), roomNumber: form.get('roomNumber'), contactNumber: form.get('contactNumber'),
      paymentMethod: form.get('paymentMethod'), instructions: form.get('instructions'),
      items: app.cart.map(line => ({ id: line.id, quantity: line.quantity })),
    }) });
    app.orders = [order, ...app.orders.filter(savedOrder => savedOrder.orderNumber !== order.orderNumber)];
    save('hh_orders', app.orders);
    app.cart = [];
    persistCart(); renderCart();
    const cartRoom = $('#cart-room');
    if (cartRoom) cartRoom.value = form.get('roomNumber');
    closeCheckout();
    const confirmationOrder = $('#confirmation-order');
    if (confirmationOrder) confirmationOrder.textContent = `${order.orderNumber} · ${currency(order.total)}`;
    app.pendingCheckoutOrder = order.orderNumber;
    $('#confirm-scrim')?.classList.add('is-open');
  } catch (error) {
    if (checkoutError) checkoutError.textContent = error.message;
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = 'Place order <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>';
    }
  }
}

function statusClass(status) { return `status-${status.toLowerCase().replaceAll(' ', '-')}`; }

function renderGuestOrders() {
  const container = $('#orders-list');
  if (!container) return;
  if (!app.orders.length) {
    container.innerHTML = '<div class="orders-empty"><div><i class="fa-solid fa-plate-wheat" aria-hidden="true"></i><h3>Your next good meal starts here.</h3><p>Once you have placed an order, we will keep its journey right here.</p><a href="#menu" data-view-link="menu" class="button button-green">Explore the menu <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></div></div>';
    return;
  }
  container.innerHTML = app.orders.map(order => `<article class="guest-order-card"><div><span class="guest-order-id">${escapeHtml(order.orderNumber)}</span><div class="guest-order-meta">${escapeHtml(order.guestName)} · Room ${escapeHtml(order.roomNumber)} · ${manilaDate(order.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</div></div><div><div class="guest-order-items">${(order.items || []).map(item => `${item.quantity} × ${escapeHtml(item.name)}`).join(', ')}</div><div class="guest-order-total">${currency(order.total)}</div></div><span class="order-status ${statusClass(order.status)}">${escapeHtml(order.status)}</span></article>`).join('');
}

async function refreshGuestOrders() {
  if (!app.orders.length) return;
  const refreshed = await Promise.all(app.orders.map(async order => {
    try { return await api(`/api/orders/${encodeURIComponent(order.orderNumber)}?token=${encodeURIComponent(order.accessToken)}`); }
    catch { return order; }
  }));
  app.orders = refreshed;
  save('hh_orders', app.orders);
  if (location.hash === '#orders') renderGuestOrders();
}

function setAdmin(admin) {
  app.admin = admin;
  const adminLogin = $('#admin-login');
  const adminApp = $('#admin-app');
  if (adminLogin) adminLogin.hidden = Boolean(admin);
  if (adminApp) adminApp.hidden = !admin;
  if (admin) {
    const staffEmail = $('#staff-email');
    if (staffEmail) staffEmail.textContent = admin.email;
    loadAdminData();
    startAdminPolling();
  } else {
    clearInterval(app.polling);
    app.polling = null;
  }
}

function showAdminApp() {
  if (!app.admin) return;
  $('#admin-login')?.setAttribute('hidden', 'true');
  $('#admin-app')?.removeAttribute('hidden');
}

async function checkSession() {
  try { setAdmin(await api('/api/admin/me')); }
  catch { setAdmin(null); }
}

async function login(event) {
  event.preventDefault();
  const button = $('.login-submit');
  const email = $('#login-email')?.value.trim();
  const password = $('#login-password')?.value;
  const loginError = $('#login-error');
  if (loginError) loginError.textContent = '';
  if (button) {
    button.disabled = true;
    button.textContent = 'Signing in…';
  }
  try {
    setAdmin(await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ email, password }) }));
    const loginPassword = $('#login-password');
    if (loginPassword) loginPassword.value = '';
  } catch (error) {
    if (loginError) loginError.textContent = error.message;
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = 'Sign in <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>';
    }
  }
}

async function logout() {
  try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); } catch { /* The local session is cleared either way. */ }
  setAdmin(null);
  location.hash = '#home';
}

function startAdminPolling() {
  clearInterval(app.polling);
  app.polling = setInterval(() => {
    if (app.admin && document.visibilityState === 'visible') loadAdminData();
  }, 15000);
}

function selectAdminView(name) {
  const panelName = document.querySelector(`[data-admin-panel="${name}"]`) ? name : 'overview';
  if (!app.admin) return;
  app.currentAdminView = panelName;
  $$('.admin-panel').forEach(panel => panel.classList.toggle('active-admin-panel', panel.dataset.adminPanel === panelName));
  $$('.admin-nav-link').forEach(button => button.classList.toggle('active', button.dataset.adminView === panelName));
  const breadcrumbCurrent = $('#admin-breadcrumb-current');
  if (breadcrumbCurrent) breadcrumbCurrent.textContent = panelName.toUpperCase();
  $('.admin-sidebar')?.classList.remove('is-open');
  if (panelName === 'orders') loadAdminOrders();
  if (panelName === 'menu') renderAdminMenu();
  if (panelName === 'guests' || panelName === 'reports') renderGuests();
  if (panelName === 'reports') loadAdminSummary();
}

async function loadAdminData() {
  try {
    const [summary, orders] = await Promise.all([api('/api/admin/summary'), api('/api/admin/orders')]);
    app.adminOrders = orders;
    app.guests = summary.guests || [];
    renderSummary(summary);
    renderRecentOrders();
    renderOrders();
    renderGuests();
    renderAdminMenu();
  } catch (error) { if (app.admin) toast(error.message, true); }
}

async function loadAdminSummary() {
  try { renderSummary(await api('/api/admin/summary')); } catch (error) { toast(error.message, true); }
}

function renderSummary(summary) {
  const totalOrders = $('#stat-total-orders');
  if (totalOrders) totalOrders.textContent = Number(summary.totalOrders || 0).toLocaleString('en-PH');
  const pendingOrders = $('#stat-pending-orders');
  if (pendingOrders) pendingOrders.textContent = Number(summary.pendingOrders || 0).toLocaleString('en-PH');
  const completedOrders = $('#stat-completed-orders');
  if (completedOrders) completedOrders.textContent = Number(summary.completedOrders || 0).toLocaleString('en-PH');
  const totalSales = $('#stat-total-sales');
  if (totalSales) totalSales.textContent = currency(summary.totalSales);
  const pendingNavCount = $('#pending-nav-count');
  if (pendingNavCount) pendingNavCount.textContent = summary.pendingOrders ? String(summary.pendingOrders) : '';
  const adminDate = $('#admin-date');
  if (adminDate) adminDate.textContent = manilaDate(new Date(), { weekday: 'short', day: 'numeric', month: 'short' });
  
  renderSalesChart($('#sales-chart'), summary.sales || []);
  renderSalesChart($('#report-chart'), summary.sales || []);
  
  const salesByDay = summary.sales || [];
  const todayKey = dateKey(new Date());
  const weekTotal = salesByDay.filter(row => dayDifference(todayKey, row.day) < 7).reduce((sum, row) => sum + row.total, 0);
  const monthTotal = (summary.sales30 || salesByDay).reduce((sum, row) => sum + row.total, 0);
  
  const reportToday = $('#report-today');
  if (reportToday) reportToday.textContent = currency(salesByDay.find(row => row.day === todayKey)?.total || 0);
  const reportWeek = $('#report-week');
  if (reportWeek) reportWeek.textContent = currency(weekTotal);
  const reportMonth = $('#report-month');
  if (reportMonth) reportMonth.textContent = currency(monthTotal);
  
  const sellers = summary.bestSellers || [];
  const bestSellers = $('#best-sellers');
  if (bestSellers) {
    bestSellers.innerHTML = sellers.length ? sellers.map(item => `<div class="best-seller-row"><span>${escapeHtml(item.name)}</span><strong>${item.quantity} sold</strong></div>`).join('') : '<div class="recent-empty">Completed orders will reveal your best sellers.</div>';
  }
  
  const stats = summary.statusCounts || [];
  const statuses = ['Pending', 'Confirmed', 'Preparing', 'Ready for Delivery', 'Out for Delivery', 'Delivered', 'Cancelled'];
  const countFor = status => stats.find(row => row.status === status)?.count || 0;
  const orderStatistics = $('#order-statistics');
  if (orderStatistics) {
    orderStatistics.innerHTML = statuses.map(status => `<div class="order-stat-cell"><span>${escapeHtml(status.toUpperCase())}</span><strong>${countFor(status)}</strong></div>`).join('');
  }
}

function dateKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dayDifference(endKey, startKey) { return Math.floor((Date.parse(`${endKey}T00:00:00Z`) - Date.parse(`${startKey}T00:00:00Z`)) / 86400000); }

function renderSalesChart(container, sales) {
  if (!container) return;
  const byDay = new Map(sales.map(row => [row.day, Number(row.total)]));
  const today = new Date(`${dateKey(new Date())}T00:00:00Z`);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    const label = new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', weekday: 'short' }).format(date).slice(0, 2);
    return { key, label, total: byDay.get(key) || 0 };
  });
  const maximum = Math.max(1, ...days.map(day => day.total));
  container.innerHTML = days.map((day, index) => `<div class="chart-column${index === 6 ? ' is-today' : ''}"><span class="chart-value">${day.total ? currency(day.total) : ' '}</span><div class="chart-bar-track"><div class="chart-bar" style="height:${day.total ? Math.max(5, day.total / maximum * 100) : 3}%" title="${day.label}: ${currency(day.total)}"></div></div><span class="chart-label">${day.label}</span></div>`).join('');
}

function nextStatuses(status) {
  if (status === 'Pending') return ['Confirmed', 'Cancelled'];
  if (status === 'Confirmed') return ['Preparing', 'Cancelled'];
  if (status === 'Preparing') return ['Ready for Delivery', 'Cancelled'];
  if (status === 'Ready for Delivery') return ['Out for Delivery', 'Cancelled'];
  if (status === 'Out for Delivery') return ['Delivered'];
  return [];
}

function renderRecentOrders() {
  const recentOrders = $('#recent-orders');
  if (!recentOrders) return;
  const recent = app.adminOrders.slice(0, 6);
  recentOrders.innerHTML = recent.length ? recent.map(order => {
    const icon = order.status === 'Delivered' ? 'fa-check' : order.status === 'Cancelled' ? 'fa-xmark' : 'fa-utensils';
    return `<div class="recent-order-row"><div class="recent-order-main"><span class="recent-order-marker"><i class="fa-solid ${icon}" aria-hidden="true"></i></span><div class="recent-order-copy"><strong>${escapeHtml(order.guestName)} · Room ${escapeHtml(order.roomNumber)}</strong><span>${escapeHtml(order.orderNumber)} · ${escapeHtml(order.status)}</span></div></div><div class="recent-order-end"><strong>${currency(order.total)}</strong><span class="table-secondary">${manilaDate(order.createdAt, { hour: 'numeric', minute: '2-digit' })}</span></div></div>`;
  }).join('') : '<div class="recent-empty">The next order is just around the corner.</div>';
}

function getFilteredOrders() {
  const query = ($('#order-search')?.value || '').trim().toLowerCase();
  const status = $('#order-status-filter')?.value || '';
  const from = $('#order-from')?.value || '';
  const to = $('#order-to')?.value || '';
  return app.adminOrders.filter(order => {
    const date = dateKey(new Date(order.createdAt));
    return (!query || `${order.orderNumber} ${order.guestName} ${order.roomNumber} ${order.items}`.toLowerCase().includes(query)) && (!status || order.status === status) && (!from || date >= from) && (!to || date <= to);
  });
}

function renderOrders() {
  const body = $('#orders-table-body');
  const ordersEmpty = $('#orders-empty');
  if (!body) return;
  const orders = getFilteredOrders();
  if (ordersEmpty) ordersEmpty.hidden = orders.length > 0;
  body.innerHTML = orders.map(order => {
    const options = nextStatuses(order.status);
    return `<tr><td><span class="table-primary">${escapeHtml(order.orderNumber)}</span><span class="table-secondary">#${new Date(order.createdAt).getTime().toString().slice(-6)}</span></td><td><span class="table-primary">${escapeHtml(order.guestName)}</span><span class="table-secondary">Room ${escapeHtml(order.roomNumber)} · ${escapeHtml(order.contactNumber || 'No contact')}</span></td><td><span class="table-items">${escapeHtml(order.items || 'No items')}</span></td><td class="table-total">${currency(order.total)}</td><td>${escapeHtml(order.paymentMethod)}</td><td class="status-cell"><span class="order-status ${statusClass(order.status)}">${escapeHtml(order.status)}</span></td><td>${manilaDate(order.createdAt, { day: 'numeric', month: 'short' })}<span class="table-secondary">${manilaDate(order.createdAt, { hour: 'numeric', minute: '2-digit' })}</span></td><td class="row-actions"><button class="action-button" data-order-detail="${escapeHtml(order.orderNumber)}">Details</button>${options.length ? `<label class="sr-only" for="status-${escapeHtml(order.orderNumber)}">Update status for ${escapeHtml(order.orderNumber)}</label><select class="action-button" id="status-${escapeHtml(order.orderNumber)}" data-order-status="${escapeHtml(order.orderNumber)}"><option value="">Update status</option>${options.map(option => `<option>${escapeHtml(option)}</option>`).join('')}</select>` : ''}</td></tr>`;
  }).join('');
}

async function loadAdminOrders() {
  if (!app.admin) return;
  try {
    const params = new URLSearchParams();
    if ($('#order-status-filter')?.value) params.set('status', $('#order-status-filter').value);
    if ($('#order-search')?.value) params.set('search', $('#order-search').value.trim());
    if ($('#order-from')?.value) params.set('from', $('#order-from').value);
    if ($('#order-to')?.value) params.set('to', $('#order-to').value);
    app.adminOrders = await api(`/api/admin/orders${params.size ? `?${params}` : ''}`);
    renderOrders(); renderRecentOrders();
  } catch (error) { toast(error.message, true); }
}

async function updateOrderStatus(orderNumber, status) {
  if (!status) return;
  const action = status === 'Cancelled' ? 'Cancel this order' : `Change this order to ${status}`;
  if (!window.confirm(`${action}? The guest's order status will update.`)) { renderOrders(); return; }
  try {
    await api(`/api/admin/orders/${encodeURIComponent(orderNumber)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    toast(`${orderNumber} updated to ${status}.`);
    await loadAdminData();
  } catch (error) { toast(error.message, true); }
}

function renderGuests() {
  const guestsTableBody = $('#guests-table-body');
  if (!guestsTableBody) return;
  const query = ($('#guest-search')?.value || '').trim().toLowerCase();
  const guests = app.guests.filter(guest => `${guest.name} ${guest.roomNumber} ${guest.contactNumber}`.toLowerCase().includes(query));
  const guestsEmpty = $('#guests-empty');
  if (guestsEmpty) guestsEmpty.hidden = guests.length > 0;
  guestsTableBody.innerHTML = guests.map(guest => `<tr><td><span class="table-primary">${escapeHtml(guest.name)}</span></td><td>Room ${escapeHtml(guest.roomNumber)}</td><td>${escapeHtml(guest.contactNumber)}</td><td>${guest.orderCount}</td><td>${manilaDate(guest.lastOrder, { day: 'numeric', month: 'short', year: 'numeric' })}</td></tr>`).join('');
}

function renderAdminMenu() {
  const container = $('#admin-menu-grid');
  if (!container || !app.admin) return;
  container.innerHTML = app.menu.map(item => `<article class="admin-menu-card"><img src="${escapeHtml(item.imageUrl || placeholderImage)}" alt="${escapeHtml(item.name)}" loading="lazy" onerror="this.src='${placeholderImage}'"><div class="admin-menu-card-info"><span>${escapeHtml(item.category)}</span><h3 title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</h3><p>${currency(item.price)}</p><div class="admin-menu-card-actions"><button class="menu-availability ${item.available ? 'is-available' : 'is-unavailable'}" data-menu-toggle="${item.id}">${item.available ? 'Available' : 'Unavailable'}</button><div><button class="menu-action-button" data-menu-edit="${item.id}" aria-label="Edit ${escapeHtml(item.name)}" title="Edit item"><i class="fa-solid fa-pen" aria-hidden="true"></i></button><button class="menu-action-button" data-menu-delete="${item.id}" aria-label="Delete ${escapeHtml(item.name)}" title="Delete item"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button></div></div></div></article>`).join('') || '<div class="admin-empty">No menu items yet. Add your first dish.</div>';
}

function openMenuDialog(item = null) {
  $('#menu-form')?.reset();
  const menuItemId = $('#menu-item-id');
  if (menuItemId) menuItemId.value = item?.id ?? '';
  const menuItemName = $('#menu-item-name');
  if (menuItemName) menuItemName.value = item?.name || '';
  const menuItemDesc = $('#menu-item-description');
  if (menuItemDesc) menuItemDesc.value = item?.description || '';
  const menuItemPrice = $('#menu-item-price');
  if (menuItemPrice) menuItemPrice.value = item?.price || '';
  const menuItemCategory = $('#menu-item-category');
  if (menuItemCategory) menuItemCategory.value = item?.category || 'Breakfast';
  const menuItemAvailable = $('#menu-item-available');
  if (menuItemAvailable) menuItemAvailable.checked = item ? Boolean(item.available) : true;
  const menuItemFeatured = $('#menu-item-featured');
  if (menuItemFeatured) menuItemFeatured.checked = item ? Boolean(item.featured) : false;
  const menuItemImage = $('#menu-item-image');
  if (menuItemImage) menuItemImage.value = '';
  const menuFormError = $('#menu-form-error');
  if (menuFormError) menuFormError.textContent = '';
  const menuDialogTitle = $('#menu-dialog-title');
  if (menuDialogTitle) menuDialogTitle.innerHTML = item ? 'Edit a <em>dish.</em>' : 'Add a <em>dish.</em>';
  const saveMenuButton = $('#save-menu-button');
  if (saveMenuButton) saveMenuButton.innerHTML = item ? 'Save changes <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>' : 'Save dish <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>';
  $('#menu-dialog')?.showModal();
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}

async function saveMenuItem(event) {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const button = $('#save-menu-button');
  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Saving…';
  }
  const menuFormError = $('#menu-form-error');
  if (menuFormError) menuFormError.textContent = '';
  const id = $('#menu-item-id')?.value;
  let imageUrl = id ? app.menu.find(item => item.id === Number(id))?.imageUrl || '' : '';
  const file = $('#menu-item-image')?.files[0];
  try {
    if (file) {
      if (file.size > 3 * 1024 * 1024) throw new Error('Choose an image smaller than 3 MB.');
      const uploaded = await api('/api/admin/upload', { method: 'POST', body: JSON.stringify({ data: await readFile(file) }) });
      imageUrl = uploaded.imageUrl;
    }
    const body = {
      name: $('#menu-item-name')?.value.trim(), description: $('#menu-item-description')?.value.trim(),
      price: Number($('#menu-item-price')?.value), category: $('#menu-item-category')?.value,
      imageUrl, available: $('#menu-item-available')?.checked, featured: $('#menu-item-featured')?.checked,
    };
    await api(id ? `/api/admin/menu/${id}` : '/api/admin/menu', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    $('#menu-dialog')?.close();
    toast('The menu has been updated.');
    await loadMenu(); renderAdminMenu();
  } catch (error) {
    if (menuFormError) menuFormError.textContent = error.message;
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = id ? 'Save changes <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>' : 'Save dish <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>';
    }
  }
}

async function toggleMenuItem(id) {
  const item = app.menu.find(product => product.id === Number(id));
  if (!item) return;
  try {
    await api(`/api/admin/menu/${id}`, { method: 'PATCH', body: JSON.stringify({ available: !item.available }) });
    await loadMenu(); renderAdminMenu(); toast(`${item.name} is now ${item.available ? 'unavailable' : 'available'}.`);
  } catch (error) { toast(error.message, true); }
}

async function deleteMenuItem(id) {
  const item = app.menu.find(product => product.id === Number(id));
  if (!item || !window.confirm(`Remove ${item.name} from the menu? Existing order records will be kept.`)) return;
  try {
    await api(`/api/admin/menu/${id}`, { method: 'DELETE' });
    await loadMenu(); renderAdminMenu(); toast('The dish has been removed.');
  } catch (error) { toast(error.message, true); }
}

async function showOrderDetails(orderNumber) {
  try {
    const order = await api(`/api/admin/orders/${encodeURIComponent(orderNumber)}`);
    const timeline = ['Pending', 'Confirmed', 'Preparing', 'Ready for Delivery', 'Out for Delivery', 'Delivered'];
    const index = timeline.indexOf(order.status);
    const finalIndex = index < 0 ? timeline.indexOf('Pending') : index;
    const content = $('#order-dialog-content');
    if (!content) return;
    content.className = 'order-dialog-content';
    content.innerHTML = `<p class="eyebrow"><span></span> A CLOSER LOOK</p><h2 class="order-dialog-title">${escapeHtml(order.orderNumber)}</h2><p class="order-dialog-meta">${escapeHtml(order.guestName)} · Room ${escapeHtml(order.roomNumber)}<br>${escapeHtml(order.paymentMethod)} · ${manilaDate(order.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}<br><span class="order-status ${statusClass(order.status)}">${escapeHtml(order.status)}</span></p><div class="order-detail-items">${order.items.map(item => `<div class="order-detail-row"><span>${item.quantity} × ${escapeHtml(item.name)}</span><strong>${currency(item.lineTotal)}</strong></div>`).join('')}<div class="order-detail-row"><strong>Total</strong><strong>${currency(order.total)}</strong></div></div>${order.instructions ? `<p class="order-detail-notes"><strong>Guest note:</strong> ${escapeHtml(order.instructions)}</p>` : ''}<p class="eyebrow"><span></span> SERVICE PROGRESS</p><div class="dialog-timeline">${timeline.map((status, step) => `<div class="timeline-step ${step <= finalIndex ? 'is-complete' : ''}"><i class="fa-solid ${step < finalIndex ? 'fa-circle-check' : step === finalIndex ? 'fa-circle-dot' : 'fa-circle'}" aria-hidden="true"></i>${status}</div>`).join('')}${order.status === 'Cancelled' ? '<div class="timeline-step is-complete"><i class="fa-solid fa-circle-xmark" aria-hidden="true"></i>Cancelled</div>' : ''}</div>`;
    $('#order-dialog')?.showModal();
  } catch (error) { toast(error.message, true); }
}

function exportReport() {
  const rows = [['Order ID', 'Guest name', 'Room', 'Items', 'Total PHP', 'Payment', 'Status', 'Date']];
  for (const order of app.adminOrders) {
    rows.push([order.orderNumber, order.guestName, order.roomNumber, order.items, order.total, order.paymentMethod, order.status, new Date(order.createdAt).toISOString()]);
  }
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = `harbor-house-orders-${dateKey(new Date())}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast('Report downloaded successfully.');
}

// Event Bindings & Initialization
document.addEventListener('DOMContentLoaded', () => {
  loadMenu();
  routeFromHash();
  window.addEventListener('hashchange', routeFromHash);

  // Global click listeners for navigation, triggers, cart actions, etc.
  document.body.addEventListener('click', event => {
    const viewLink = event.target.closest('[data-view-link]');
    if (viewLink) {
      event.preventDefault();
      location.hash = `#${viewLink.dataset.viewLink}`;
    }

    const categoryLink = event.target.closest('[data-category-link]');
    if (categoryLink) {
      event.preventDefault();
      app.category = categoryLink.dataset.categoryLink;
      app.search = '';
      location.hash = '#menu';
    }

    const categoryTab = event.target.closest('.category-tab');
    if (categoryTab) {
      app.category = categoryTab.dataset.category;
      renderMenu();
    }

    const addItemBtn = event.target.closest('[data-add-item]');
    if (addItemBtn) {
      addToCart(Number(addItemBtn.dataset.addItem));
    }

    const cartActionBtn = event.target.closest('[data-cart-action]');
    if (cartActionBtn) {
      changeCart(Number(cartActionBtn.dataset.id), cartActionBtn.dataset.cartAction);
    }

    if (event.target.closest('#cart-trigger') || event.target.closest('.cart-trigger')) {
      openCart();
    }

    if (event.target.closest('#close-cart') || event.target.closest('#cart-scrim')) {
      closeCart();
    }

    if (event.target.closest('#checkout-button')) {
      openCheckout();
    }

    if (event.target.closest('#close-checkout') || event.target.closest('#checkout-scrim')) {
      closeCheckout();
    }

    if (event.target.closest('#staff-link')) {
      location.hash = '#admin';
    }

    const adminNavBtn = event.target.closest('[data-admin-view]');
    if (adminNavBtn) {
      selectAdminView(adminNavBtn.dataset.adminView);
    }

    const adminNavActionBtn = event.target.closest('[data-admin-nav]');
    if (adminNavActionBtn) {
      selectAdminView(adminNavActionBtn.dataset.adminNav);
    }

    const menuToggleBtn = event.target.closest('[data-menu-toggle]');
    if (menuToggleBtn) {
      toggleMenuItem(menuToggleBtn.dataset.menuToggle);
    }

    const menuEditBtn = event.target.closest('[data-menu-edit]');
    if (menuEditBtn) {
      const item = app.menu.find(p => p.id === Number(menuEditBtn.dataset.menuEdit));
      if (item) openMenuDialog(item);
    }

    const menuDeleteBtn = event.target.closest('[data-menu-delete]');
    if (menuDeleteBtn) {
      deleteMenuItem(menuDeleteBtn.dataset.menuDelete);
    }

    if (event.target.closest('#add-menu-item')) {
      openMenuDialog();
    }

    if (event.target.closest('#close-menu-dialog')) {
      $('#menu-dialog')?.close();
    }

    const orderDetailBtn = event.target.closest('[data-order-detail]');
    if (orderDetailBtn) {
      showOrderDetails(orderDetailBtn.dataset.orderDetail);
    }

    if (event.target.closest('#close-order-dialog')) {
      $('#order-dialog')?.close();
    }

    if (event.target.closest('#export-report')) {
      exportReport();
    }

    if (event.target.closest('#logout-button')) {
      logout();
    }

    if (event.target.closest('#refresh-orders')) {
      loadAdminOrders();
    }

    if (event.target.closest('#confirmation-track')) {
      $('#confirm-scrim')?.classList.remove('is-open');
      location.hash = '#orders';
    }
  });

  // Form submits
  $('#login-form')?.addEventListener('submit', login);
  $('#checkout-form')?.addEventListener('submit', placeOrder);
  $('#menu-form')?.addEventListener('submit', saveMenuItem);

  // Search input listeners
  $('#menu-search')?.addEventListener('input', event => {
    app.search = event.target.value;
    renderMenu();
  });

  $('#order-search')?.addEventListener('input', renderOrders);
  $('#order-status-filter')?.addEventListener('change', loadAdminOrders);
  $('#order-from')?.addEventListener('change', loadAdminOrders);
  $('#order-to')?.addEventListener('change', loadAdminOrders);
  $('#guest-search')?.addEventListener('input', renderGuests);

  // Admin status select changes
  document.body.addEventListener('change', event => {
    const statusSelect = event.target.closest('[data-order-status]');
    if (statusSelect) {
      updateOrderStatus(statusSelect.dataset.orderStatus, statusSelect.value);
    }
  });
});
