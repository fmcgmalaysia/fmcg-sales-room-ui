import { authentication } from 'wix-members-frontend';
import wixLocationFrontend from 'wix-location-frontend';
import { local, session } from 'wix-storage-frontend';
import wixWindowFrontend from 'wix-window-frontend';
import wixData from 'wix-data';

import { getCurrentStaffContext } from 'backend/staffAuth.web';
import { getSalesRoomCustomerDetail } from 'backend/onboarding.web';
import { addCatalogueSelection, getCatalogueSelectionState, routeCatalogueSelection } from 'backend/catalogueSelection.web';

let catalogueContextMessage = null;
let catalogueMenuMessage = null;
let principleLogoMap = new Map();
const principleCache = new Map();
let logoLoadPromise;
let selectionContext = null;
let selectedProductIds = new Set();
let selectionBusyIds = new Set();

const SELECTION_BUTTON_THEME = {
    idle: { label: 'Add to Selection', background: '#0B2A4A', color: '#FFFFFF', border: '#0B2A4A' },
    busy: { label: 'Adding…', background: '#D9E2EA', color: '#536575', border: '#D9E2EA' },
    selected: { label: '✓ In My Selection', background: '#EDF4F1', color: '#214C3D', border: '#739B8B' },
    error: { label: 'Try Again', background: '#FFF7ED', color: '#9A4B14', border: '#D9A66E' }
};

function paintSelectionButton(button, state = 'idle') {
    const theme = SELECTION_BUTTON_THEME[state] || SELECTION_BUTTON_THEME.idle;
    button.label = theme.label;
    button.style.backgroundColor = theme.background;
    button.style.color = theme.color;
    button.style.borderColor = theme.border;
    button.style.borderWidth = '1px';
    button.style.borderRadius = '8px';
}

function imageUrl(value) {
    const raw = String(value || '').trim();
    if (/^https:\/\//i.test(raw)) return raw;
    const match = /^wix:image:\/\/v1\/([^/]+)/i.exec(raw);
    return match ? `https://static.wixstatic.com/media/${match[1]}` : '';
}

async function loadPrincipleLogos() {
    // Optional CMS collection: principle (text), logo (image), featured (boolean).
    // The product collection stores principle names but does not store logo images.
    try {
        const result = await wixData.query('PrincipleLogos').limit(1000).find();
        principleLogoMap = new Map(result.items.map(item => [String(item.principle || item.title || '').trim().toLowerCase(), imageUrl(item.logo)]));
    } catch (error) {
        principleLogoMap = new Map();
    }
}

async function getPrinciplesForSub(subId) {
    if (!subId) return [];
    if (logoLoadPromise) await logoLoadPromise;
    if (principleCache.has(subId)) return principleCache.get(subId);
    const result = await wixData.query('FMCGMALAYSIA').hasSome('subCategories', [subId]).limit(1000).distinct('principle');
    const names = (result.items || []).map(value => String(value || '').trim()).filter(Boolean);
    const items = [...new Set(names)].sort((a, b) => a.localeCompare(b)).map(name => ({ name, logo: principleLogoMap.get(name.toLowerCase()) || '' }));
    principleCache.set(subId, items);
    return items;
}

function sendCatalogueContext(message) {
    catalogueContextMessage = message;
    try { $w('#html3').postMessage(message); } catch (error) {}
}

function sendCatalogueMenu(message) {
    catalogueMenuMessage = message;
    try { $w('#html4').postMessage(message); } catch (error) {}
}

function setProductActions(enabled) {
    const repeater = $w('#repeater3');
    const updateAction = ($item, itemData) => {
        try {
            if (enabled) {
                const selected = selectedProductIds.has(String(itemData?._id || ''));
                paintSelectionButton($item('#button3'), selected ? 'selected' : 'idle');
                $item('#button3').enable();
                $item('#button3').expand();
                $item('#button3').show();
            } else {
                $item('#button3').collapse();
            }
        } catch (error) {}
    };
    repeater.onItemReady(updateAction);
    repeater.forEachItem(updateAction);
}

function sidebarSelectionState(state) {
    try { $w('#html5').postMessage({ type: 'SIDEBAR_DATA', payload: { counts: state?.counts || { food: 0, household: 0, personalCare: 0, general: 0 } } }); } catch (error) {}
}

async function loadSelectionState(assistCustomerId = '') {
    const state = await getCatalogueSelectionState(assistCustomerId);
    selectedProductIds = new Set((state?.selectedProductIds || []).map(String));
    sidebarSelectionState(state);
    setProductActions(true);
    return state;
}

function setupSelectionActions() {
    const repeater = $w('#repeater3');
    const configure = ($item, itemData) => {
        const button = $item('#button3');
        button.onClick(async () => {
            const productId = String(itemData?._id || '');
            if (!selectionContext || !productId || selectionBusyIds.has(productId)) return;
            if (selectedProductIds.has(productId)) {
                openBuyerRoomWindow();
                return;
            }
            selectionBusyIds.add(productId);
            paintSelectionButton(button, 'busy');
            button.disable();
            try {
                const result = await addCatalogueSelection(productId, selectionContext.assistCustomerId || '');
                if (!result?.ok) throw new Error(result?.error || 'Quotation Desk selection sync failed.');
                if (result?.ok) selectedProductIds.add(productId);
                paintSelectionButton(button, 'selected');
                button.enable();
                getCatalogueSelectionState(selectionContext.assistCustomerId || '')
                    .then((state) => {
                        selectedProductIds = new Set((state?.selectedProductIds || []).map(String));
                        sidebarSelectionState(state);
                    })
                    .catch((error) => console.error('Selection sidebar refresh failed', error));
                // QD routing is deliberately independent from the buyer's
                // selection confirmation. Failure is retried by Sales Room.
                routeCatalogueSelection(result?.selection?.id, selectionContext.assistCustomerId || '')
                    .then((routeResult) => {
                        if (!routeResult?.ok) console.error('Background QD routing failed', routeResult?.error || routeResult);
                    })
                    .catch((error) => console.error('Background QD routing failed', error));
            } catch (error) {
                console.error('Catalogue selection failed', error);
                paintSelectionButton(button, 'error');
                button.enable();
            } finally {
                selectionBusyIds.delete(productId);
            }
        });
    };
    repeater.onItemReady(configure);
    repeater.forEachItem(configure);
}

$w.onReady(async () => {
    try { $w('#repeater3').hide(); } catch (error) {}
    const hasBuyerAccess = local.getItem('catalogueAccess') === 'granted' || session.getItem('catalogueAccess') === 'granted';
    let staff;
    try { staff = await getCurrentStaffContext(); } catch (error) { staff = null; }

    if (staff?.authorized) {
        const assistCustomerId = String(wixLocationFrontend.query?.assist || '').trim();
        if (assistCustomerId) {
            try {
                const response = await getSalesRoomCustomerDetail(assistCustomerId);
                const customer = response?.customer || {};
                session.setItem('catalogueAssistCustomerId', customer.customerId || assistCustomerId);
                selectionContext = { mode: staff.canViewAllCustomers ? 'admin' : 'assist', assistCustomerId: customer.customerId || assistCustomerId };
                await loadSelectionState(selectionContext.assistCustomerId);
                try { $w('#repeater3').show(); } catch (error) {}
                sendCatalogueContext({
                    type: 'catalogueContext', mode: staff.canViewAllCustomers ? 'admin' : 'assist',
                    sheetName: String(customer.companyName || customer.customerId || '').trim(),
                    signedInName: String(staff.staffName || staff.staffId || '').trim()
                });
            } catch (error) {
                session.removeItem('catalogueAssistCustomerId');
                wixLocationFrontend.to('/blank-1');
                return;
            }
        } else {
            session.removeItem('catalogueAssistCustomerId');
            selectionContext = null;
            setProductActions(false);
            try { $w('#repeater3').show(); } catch (error) {}
            sendCatalogueContext({ type: 'catalogueContext', mode: 'preview', signedInName: String(staff.staffName || staff.staffId || '').trim() });
        }
        return;
    }

    if (!hasBuyerAccess && wixWindowFrontend.viewMode === 'Site') { wixLocationFrontend.to('/'); return; }
    if (hasBuyerAccess) {
        try {
            selectionContext = { mode: 'buyer', assistCustomerId: '' };
            await loadSelectionState('');
            try { $w('#repeater3').show(); } catch (error) {}
            sendCatalogueContext({ type: 'catalogueContext', mode: 'buyer', signedInName: 'Buyer' });
        } catch (error) {
            selectionContext = null;
            setProductActions(false);
            local.removeItem('catalogueAccess');
            session.removeItem('catalogueAccess');
            try { $w('#repeater3').hide(); } catch (hideError) {}
            if (wixWindowFrontend.viewMode === 'Site') wixLocationFrontend.to('/buyer-room');
        }
    }
    setInterval(async () => {
        if (!selectionContext) return;
        try { await loadSelectionState(selectionContext.assistCustomerId || ''); }
        catch (error) {
            selectionContext = null;
            selectedProductIds = new Set();
            setProductActions(false);
            local.removeItem('catalogueAccess');
            session.removeItem('catalogueAccess');
            try { $w('#repeater3').hide(); } catch (hideError) {}
            if (wixWindowFrontend.viewMode === 'Site') wixLocationFrontend.to(assistCustomerId ? '/sales-room' : '/buyer-room');
        }
    }, 15000);
});

const DEFAULT_PLACEHOLDER_MEDIA_ID = '55d98a_3287270d83ef4efabfdd1f52d0dc6ec2';

function connectCardToLightbox(repeaterId, cardId, buttonId, priceId, imageId) {
    const repeater = $w(repeaterId);
    const configureCard = ($item, itemData) => {
        if (priceId) $item(priceId).collapse();
        if (imageId) {
            const image = $item(imageId);
            setTimeout(() => {
                const isDefaultPlaceholder = String(image.src || '').includes(DEFAULT_PLACEHOLDER_MEDIA_ID);
                if (!itemData.image || isDefaultPlaceholder) image.hide(); else image.show();
            }, 150);
        }
        $item(cardId).onClick((event) => {
            if (event.target && event.target.id === buttonId.slice(1)) return;
            wixWindowFrontend.openLightbox('Product Details', itemData);
        });
    };
    repeater.onItemReady(configureCard);
    repeater.forEachItem(configureCard);
}

function hideDefaultPlaceholderImages() {
    $w('#repeater3').forEachItem(($item, itemData) => {
        const image = $item('#imageX3');
        const isDefaultPlaceholder = String(image.src || '').includes(DEFAULT_PLACEHOLDER_MEDIA_ID);
        if (!itemData.image || isDefaultPlaceholder) image.hide();
    });
}

function setupCataloguePagination() {
    const dataset = $w('#dataset1');
    const pager = $w('#html2');
    $w('#pagination3').collapse();
    const sendPaginationState = () => pager.postMessage({ type: 'catalogue:update', currentPage: dataset.getCurrentPageIndex(), totalPages: dataset.getTotalPageCount() });
    pager.onMessage(async (event) => {
        const message = event.data || {};
        if (message.type === 'catalogue:ready') { sendPaginationState(); return; }
        if (message.type !== 'catalogue:page') return;
        try {
            if (message.action === 'prev' && dataset.hasPreviousPage()) await dataset.previousPage();
            else if (message.action === 'next' && dataset.hasNextPage()) await dataset.nextPage();
            else if (message.action === 'page') await dataset.loadPage(Math.max(1, Math.min(Number(message.page) || 1, dataset.getTotalPageCount())));
            setTimeout(hideDefaultPlaceholderImages, 150);
            sendPaginationState();
            await $w('#section6').scrollTo();
        } catch (error) { console.error('Catalogue pagination failed', error); sendPaginationState(); }
    });
    dataset.onReady(() => { sendPaginationState(); setTimeout(hideDefaultPlaceholderImages, 150); });
}

async function loadMenuData() {
    try {
        const result = await wixData.query('subCategories').ascending('mainCategory').ascending('title').limit(1000).find();
        sendCatalogueMenu({
            type: 'catalogueMenuData',
            items: result.items.map(item => ({ id: item._id, title: String(item.title || '').trim(), mainCategory: String(item.mainCategory || '').trim().toUpperCase() })).filter(item => item.id && item.title && item.mainCategory)
        });
    } catch (error) {
        console.error('Catalogue menu CMS load failed', error);
        sendCatalogueMenu({ type: 'catalogueMenuData', items: [] });
    }
}

function setupNav() {
    const header = $w('#html3');
    const mega = $w('#html4');
    const dataset = $w('#dataset1');
    let nativeSearch;
    try { nativeSearch = $w('#input1'); } catch (error) { nativeSearch = null; }
    let activeMain = 'FOOD';
    let isOpen = false;
    let lastScrollY = 0;
    let leaveTimer;

    const showMenu = async (main = activeMain) => {
        clearTimeout(leaveTimer);
        activeMain = main;
        if (!isOpen) await mega.expand();
        isOpen = true;
        mega.postMessage({ type: 'showMain', main: activeMain });
        setTimeout(() => {
            if (!isOpen) return;
            if (catalogueMenuMessage) mega.postMessage(catalogueMenuMessage);
            mega.postMessage({ type: 'showMain', main: activeMain });
        }, 250);
        header.postMessage({ type: 'megaState', open: true, main: activeMain });
    };

    const hideMenu = async () => {
        clearTimeout(leaveTimer);
        if (!isOpen) return;
        await mega.collapse();
        isOpen = false;
        header.postMessage({ type: 'megaState', open: false, main: activeMain });
    };

    const applySearch = async (rawQuery) => {
        const query = String(rawQuery || '').trim();
        try {
            if (query.length < 2) { await dataset.setFilter(wixData.filter()); return; }
            const subResult = await wixData.query('subCategories').contains('title', query).limit(100).find();
            let filter = wixData.filter().contains('name', query)
                .or(wixData.filter().contains('principle', query));
            const ids = subResult.items.map(item => item._id).filter(Boolean);
            if (ids.length) filter = filter.or(wixData.filter().hasSome('subCategories', ids));
            await dataset.setFilter(filter);
        } catch (error) { console.error('Catalogue search failed', error); }
    };

    // The search control is a Wix element in the same section as the header.
    // It filters the existing CMS-backed catalogue without relying on iframe sizing.
    let searchTimer;
    if (nativeSearch) nativeSearch.onInput(() => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => applySearch(nativeSearch.value), 240);
    });

    const applyMainCategory = async (main) => {
        const items = catalogueMenuMessage && Array.isArray(catalogueMenuMessage.items)
            ? catalogueMenuMessage.items
            : [];
        const ids = items
            .filter(item => String(item.mainCategory || '').toUpperCase() === String(main || '').toUpperCase())
            .map(item => item.id)
            .filter(Boolean);
        if (ids.length) await dataset.setFilter(wixData.filter().hasSome('subCategories', ids));
    };

    header.onMessage(async (event) => {
        const message = event.data || {};
        if (message.type === 'catalogueHeaderReady') {
            if (catalogueContextMessage) header.postMessage(catalogueContextMessage);
            if (catalogueMenuMessage) mega.postMessage(catalogueMenuMessage);
        } else if (message.type === 'catalogueMain') {
            if (wixWindowFrontend.formFactor === 'Mobile') {
                await hideMenu();
                await applyMainCategory(message.main);
                header.postMessage({ type: 'megaState', open: false, main: message.main });
            } else {
                message.open ? showMenu(message.main) : hideMenu();
            }
        } else if (message.type === 'catalogueMegaLeave') {
            leaveTimer = setTimeout(hideMenu, 420);
        } else if (message.type === 'catalogueSearch') {
            await applySearch(message.query);
        } else if (message.type === 'catalogueAll') {
            await hideMenu();
            if (nativeSearch) nativeSearch.value = '';
            await dataset.setFilter(wixData.filter());
        } else if (message.type === 'catalogueAccount') {
            await authentication.logout();
            wixLocationFrontend.to('/');
        } else if (message.type === 'catalogueBuyerRoom') {
            openBuyerRoomWindow();
        }
    });

    mega.onMessage(async (event) => {
        const message = event.data || {};
        if (message.type === 'catalogueMegaReady') {
            if (catalogueMenuMessage) mega.postMessage(catalogueMenuMessage);
            if (isOpen) mega.postMessage({ type: 'showMain', main: activeMain });
        } else if (message.type === 'catalogueRequestPrinciples') {
            try {
                const items = await getPrinciplesForSub(message.id);
                mega.postMessage({ type: 'cataloguePrinciples', id: message.id, requestId: message.requestId, items });
            } catch (error) {
                console.error('Catalogue principle lookup failed', error);
                mega.postMessage({ type: 'cataloguePrinciples', id: message.id, requestId: message.requestId, items: [] });
            }
        } else if (message.type === 'catalogueMegaEnter') {
            clearTimeout(leaveTimer);
        } else if (message.type === 'catalogueMegaLeave') {
            leaveTimer = setTimeout(hideMenu, 420);
        } else if (message.type === 'catalogueSub') {
            if (message.id) await dataset.setFilter(wixData.filter().hasSome('subCategories', [message.id]));
            else {
                const result = await wixData.query('subCategories').eq('title', message.sub).limit(1).find();
                if (result.items.length) await dataset.setFilter(wixData.filter().hasSome('subCategories', [result.items[0]._id]));
            }
            hideMenu();
        } else if (message.type === 'catalogueGroup') {
            const ids = Array.isArray(message.ids) ? message.ids.filter(Boolean) : [];
            if (ids.length) await dataset.setFilter(wixData.filter().hasSome('subCategories', ids));
            hideMenu();
        } else if (message.type === 'cataloguePrinciple') {
            const principle = String(message.principle || '').trim();
            if (!principle) return;
            let filter = wixData.filter().eq('principle', principle);
            if (message.subId) filter = filter.hasSome('subCategories', [message.subId]);
            await dataset.setFilter(filter);
            hideMenu();
        }
    });

    mega.collapse();
    dataset.onReady(() => dataset.setPageSize(30));
    loadMenuData();
    logoLoadPromise = loadPrincipleLogos();
    setInterval(async () => {
        const currentY = (await wixWindowFrontend.getBoundingRect()).scroll.y;
        if (currentY - lastScrollY > 8 && currentY > 160) hideMenu();
        lastScrollY = currentY;
    }, 180);
}

function setupSidebar() {
    const sidebar = $w('#html5');
    sidebar.onMessage((event) => {
        if (event.data?.type === 'OPEN_BUYER_ROOM') openBuyerRoomWindow();
    });
}

function openBuyerRoom() {
    const assistCustomerId = String(selectionContext?.assistCustomerId || session.getItem('catalogueAssistCustomerId') || '').trim();
    wixLocationFrontend.to(assistCustomerId ? '/buyer-room?assist=' + encodeURIComponent(assistCustomerId) : '/buyer-room');
}

function openBuyerRoomWindow() {
    const assistCustomerId = String(selectionContext?.assistCustomerId || session.getItem('catalogueAssistCustomerId') || '').trim();
    const path = assistCustomerId ? '/buyer-room?assist=' + encodeURIComponent(assistCustomerId) : '/buyer-room';
    try { $w('#html3').postMessage({ type: 'OPEN_BUYER_ROOM_WINDOW', path }); }
    catch (_) { openBuyerRoom(); }
}

function setupFluidCatalogueLayout() {
    const classMap = [
        ['#section6', 'catalogue-results-stage'],
        ['#box19', 'catalogue-results-shell']
    ];

    classMap.forEach(([selector, className]) => {
        // @ts-ignore - selectors are validated by the fixed map above.
        try { $w(selector).customClassList.add(className); }
        catch (error) { console.warn(`Catalogue layout class failed for ${selector}`, error); }
    });
}

$w.onReady(() => {
    setupFluidCatalogueLayout();
    setupSelectionActions();
    connectCardToLightbox('#repeater3', '#box17', '#button3', '#text16', '#imageX3');
    setupCataloguePagination();
    setupNav();
    setupSidebar();
});

