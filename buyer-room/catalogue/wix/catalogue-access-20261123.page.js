import { connectAccountSession } from 'public/wix-account-session.js';
import { authentication } from 'wix-members-frontend';
import wixLocationFrontend from 'wix-location-frontend';
import { local, session } from 'wix-storage-frontend';
import wixWindowFrontend from 'wix-window-frontend';
import wixData from 'wix-data';

import { getCurrentStaffContext } from 'backend/staffAuth.web.js';
import { addCatalogueSelection, getCatalogueSelectionState } from 'backend/catalogueSelection.web.js';
import { listCataloguePage, readCatalogueProduct, listCataloguePrinciples, readCatalogueSelectionCounts, readCatalogueThumbnails } from 'backend/protectedCatalogue.web.js';
import { getBuyerCompanies } from 'backend/catalogueAuth.web.js';
import { cataloguePictureProgress, continueCataloguePictures } from 'backend/cataloguePhotoMigrationAdmin.web.js';
import { loadBuyerCompanyAccess, buyerCompanyPath, selectedBuyerCompanyId } from 'public/buyerCompanyNavigation.js';

let catalogueContextMessage = null;
let catalogueAccountSession;
let catalogueAccountMenuReady = false;
let catalogueAccountMenuRequested = false;

function openCatalogueAccountMenu(workspace) {
    if (!catalogueAccountMenuReady) {
        catalogueAccountMenuRequested = true;
        return;
    }
    catalogueAccountMenuRequested = false;
    workspace.postMessage({
        type: 'catalogueAccountMenu',
        signedIn: authentication.loggedIn(),
        name: catalogueContextMessage?.signedInName || '',
        company: catalogueContextMessage?.sheetName || ''
    });
}

function signOutCatalogue() {
    return catalogueAccountSession.signOut(() => {
        if (catalogueBrowseKey) {
            try { local.removeItem(catalogueBrowseKey); } catch (error) {}
            catalogueBrowseKey = '';
        }
    });
}
let catalogueMenuMessage = null;
let principleLogoMap = new Map();
const principleCache = new Map();
let logoLoadPromise;
let selectionContext = null;
let selectedProductIds = new Set();
let activeSelectedProductIds = new Set();
let removedProductIds = new Set();
let selectionBusyIds = new Set();
const CATALOGUE_BUILD_VERSION = '20261127-catalogue-priority-images-v1';
const joinedMobileSelections = new Set();
const MOBILE_SELECTION_FLIGHT_MS = 120000;
const NON_FOOD_CATEGORY_KEYS = new Set(['HOUSEHOLDS', 'PERSONAL CARE', 'OTHERS']);
let catalogueReadScope = null;
let catalogueWorkspaceProducts = [];
let catalogueWorkspaceReady = false;
let catalogueWorkspaceInstance = '';
let thumbnailWorkspace = false;
let assistedContextMs;
let catalogueSelectionLimit = 100;
let catalogueSelectionTotal = 0;
let catalogueSelectionResolved = false;
let catalogueWorkspaceFilter = { query: '', subIds: [], principle: '', selectionView: '' };
let catalogueWorkspaceQueryVersion = 0;
let cataloguePageStatus = 'loading';
let catalogueNext = null, cataloguePrevious = null;
let catalogueCounts = null, countVersion = 0;
let currentPageRequest = {};
let pageStarted = false;
let selectionReturnFilter;
let catalogueBrowseRevision = 0;
let catalogueBrowseSubIds = [];
let catalogueBrowseKey = '';
let catalogueBrowsePosition = null;
let catalogueBuyerNavigationPending = false;

function mobileSelectionFlightKey(productId) {
    return selectionContext?.mode === 'buyer' && catalogueBrowseKey
        ? 'catalogueSelectionFlightV1:' + catalogueBrowseKey + ':' + encodeURIComponent(productId)
        : '';
}

function readMobileSelectionFlight(key) {
    if (!key) return null;
    try {
        const value = JSON.parse(local.getItem(key) || 'null');
        return value && typeof value.owner === 'string' && Number.isFinite(value.expiresAt) ? value : null;
    } catch (error) { return null; }
}

function claimMobileSelectionFlight(key) {
    if (!key) return '';
    const owner = Date.now() + '-' + Math.random().toString(36).slice(2);
    try {
        local.setItem(key, JSON.stringify({ owner, expiresAt: Date.now() + MOBILE_SELECTION_FLIGHT_MS }));
        return owner;
    } catch (error) { return ''; }
}

function releaseMobileSelectionFlight(key, owner) {
    if (!owner || readMobileSelectionFlight(key)?.owner !== owner) return;
    try { local.removeItem(key); } catch (error) {}
}

function publishCatalogueSearchValue() {
    try { $w('#html3').postMessage({ type: 'catalogueHeaderFilter', query: catalogueWorkspaceFilter.query }); } catch (error) {}
}

function recordCatalogueBrowse(subIds, position = null) {
    catalogueBrowseRevision += 1;
    catalogueBrowseSubIds = subIds;
    catalogueBrowsePosition = position;
}

function workspaceFilterMessage() {
    const message = { type: 'catalogueWorkspaceFilter', ...catalogueWorkspaceFilter, browseRevision: catalogueBrowseRevision };
    if (wixWindowFrontend.formFactor !== 'Mobile') return message;
    const position = catalogueBrowsePosition;
    catalogueBrowsePosition = null;
    return { ...message, position };
}

function rememberMobileCataloguePosition(message) {
    if (!catalogueBrowseKey || catalogueBrowseSubIds === null || message.browseRevision !== catalogueBrowseRevision) return;
    const { anchor, offset } = message;
    if (typeof anchor !== 'string' || anchor.length > 100 || !Number.isInteger(offset) || offset < 0 || offset > 200) return;
    try {
        local.setItem(catalogueBrowseKey, JSON.stringify({
            query: catalogueWorkspaceFilter.query, principle: catalogueWorkspaceFilter.principle,
            subIds: catalogueBrowseSubIds, anchor, offset
        }));
    } catch (error) {}
}

async function restoreMobileCataloguePosition(customerId) {
    if (wixWindowFrontend.formFactor !== 'Mobile' || !customerId) return;
    catalogueBrowseKey = 'catalogueBrowseReturnV1:' + customerId;
    let saved;
    try { saved = JSON.parse(local.getItem(catalogueBrowseKey) || 'null'); }
    catch (error) { return; }
    if (!saved || catalogueWorkspaceQueryVersion !== 0) return;
    const { query, principle, subIds, anchor, offset } = saved;
    if (typeof query !== 'string' || query.length > 200 || typeof principle !== 'string' || principle.length > 200
        || !Array.isArray(subIds) || subIds.length > 100 || !subIds.every(id => typeof id === 'string' && /^[a-z0-9_-]{1,100}$/i.test(id))
        || typeof anchor !== 'string' || anchor.length > 100 || !Number.isInteger(offset) || offset < 0 || offset > 200) return;
    catalogueWorkspaceFilter = { query, subIds, principle, selectionView: '' };
    currentPageRequest = { anchorId: anchor };
    recordCatalogueBrowse(subIds, { anchor, offset });
    if (query) { try { $w('#input2').value = query; } catch (_) {} }
    publishCatalogueSearchValue();
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
    if (!logoLoadPromise) logoLoadPromise = loadPrincipleLogos();
    await logoLoadPromise;
    if (principleCache.has(subId)) return principleCache.get(subId);
    if (!catalogueReadScope) return [];
    const names = await listCataloguePrinciples(catalogueReadScope, subId);
    const items = [...new Set(names)].sort((a, b) => a.localeCompare(b)).map(name => ({ name, logo: principleLogoMap.get(name.toLowerCase()) || '' }));
    principleCache.set(subId, items);
    return items;
}

function sendCatalogueContext(message) {
    catalogueContextMessage = { ...message, buyerRoomUrl: buyerRoomUrl(message.mode) };
    try { $w('#text19').text = String(message.sheetName || 'FMCG Malaysia').trim(); } catch (error) {}
    try { $w('#text20').text = String(message.signedInName || 'Buyer').trim(); } catch (error) {}
    try { $w('#html3').postMessage(catalogueContextMessage); } catch (error) {}
    sendCatalogueWorkspaceData();
}

function sendCatalogueMenu(message) {
    catalogueMenuMessage = message;
    try { $w('#html4').postMessage(message); } catch (error) {}
    try { $w('#html5').postMessage(message); } catch (error) {}
}

function sameCatalogueIdSet(current, next) {
    return current.size === next.size && [...next].every(id => current.has(id));
}

function sidebarSelectionState(state) {
    const selected = new Set((state?.selectedProductIds || []).map(String));
    const active = new Set((state?.activeSelectedProductIds || state?.selectedProductIds || []).map(String));
    const removed = new Set((state?.removedProductIds || []).map(String));
    const limit = Number(state?.selectionLimit) || 100;
    if (catalogueSelectionResolved && catalogueSelectionLimit === limit &&
        sameCatalogueIdSet(selectedProductIds, selected) && sameCatalogueIdSet(activeSelectedProductIds, active) &&
        sameCatalogueIdSet(removedProductIds, removed)) return;
    removedProductIds = removed;
    selectedProductIds = selected;
    activeSelectedProductIds = active;
    catalogueSelectionLimit = limit;
    catalogueSelectionTotal = activeSelectedProductIds.size;
    catalogueSelectionResolved = true;
    if (catalogueReadScope) void refreshCounts();
    sendCatalogueWorkspaceData();
}

async function refreshCounts() {
    const scope = catalogueReadScope;
    const version = ++countVersion;
    catalogueCounts = null;
    try {
        const result = await readCatalogueSelectionCounts(scope);
        if (version === countVersion && scope === catalogueReadScope) catalogueCounts = result;
    } catch (_) { /* A missing count is shown as pending. */ }
    if (version === countVersion) sendCatalogueWorkspaceData();
}

function sendCatalogueWorkspaceData() {
    if (!catalogueWorkspaceReady) return;
    $w('#html5').postMessage({
        type: 'catalogueWorkspaceData', products: catalogueWorkspaceProducts,
        selectedProductIds: [...selectedProductIds], activeSelectedProductIds: [...activeSelectedProductIds],
        removedProductIds: [...removedProductIds], selectionLimit: catalogueSelectionLimit,
        selectionTotal: catalogueSelectionTotal, selectionFoodCount: catalogueCounts?.food,
        selectionNonFoodCount: catalogueCounts?.nonFood, selectionCountsReady: catalogueCounts?.total === catalogueSelectionTotal,
        selectionReady: catalogueSelectionResolved && Boolean(selectionContext) && Boolean(catalogueReadScope),
        buyerRoomUrl: buyerRoomUrl(), context: catalogueContextMessage, buildVersion: CATALOGUE_BUILD_VERSION,
        pageVersion: catalogueWorkspaceQueryVersion, pageStatus: cataloguePageStatus,
        thumbnailsDeferred: thumbnailWorkspace,
        hasPrevious: cataloguePrevious !== null, hasNext: catalogueNext !== null,
        selectionView: catalogueWorkspaceFilter.selectionView || ''
    });
    if (cataloguePageStatus === 'ready') $w('#html5').postMessage(workspaceFilterMessage());
}

async function fetchPage(position = {}, edge = '') {
    currentPageRequest = position;
    if (!catalogueReadScope || !catalogueWorkspaceReady) return;
    const version = ++catalogueWorkspaceQueryVersion;
    const scope = catalogueReadScope;
    const filter = catalogueWorkspaceFilter;
    pageStarted = true;
    catalogueWorkspaceProducts = [];
    cataloguePageStatus = 'loading';
    catalogueNext = cataloguePrevious = null;
    sendCatalogueWorkspaceData();
    try {
        const measureTiming = wixLocationFrontend.query?.catalogueTiming === '1';
        const requestStarted = measureTiming ? Date.now() : 0;
        const result = await listCataloguePage(scope, {
            term: filter.query, principle: filter.principle, subcategories: filter.subIds,
            selectionView: filter.selectionView || '', size: 25,
            deferImages: thumbnailWorkspace, ...position, ...(measureTiming ? { measureTiming } : {})
        });
        if (scope !== catalogueReadScope || version !== catalogueWorkspaceQueryVersion) return;
        if (result.timing) $w('#text20').text = 'Catalogue timing ' + JSON.stringify({
            firstPage: version === 1, assistedContextMs, rpcMs: Date.now() - requestStarted, ...result.timing
        });
        catalogueWorkspaceProducts = result.items;
        cataloguePrevious = result.previousAfterId;
        catalogueNext = result.afterId;
        cataloguePageStatus = 'ready';
        if (edge) catalogueWorkspaceFilter = { ...filter, edge };
    } catch (_) {
        if (scope !== catalogueReadScope || version !== catalogueWorkspaceQueryVersion) return;
        cataloguePageStatus = 'failed';
    }
    sendCatalogueWorkspaceData();
}

function showView({ query = '', principle = '', subIds = [], selectionView = '' } = {}) {
    catalogueWorkspaceFilter = { query, principle, subIds, selectionView };
    recordCatalogueBrowse(subIds);
    return fetchPage();
}

function setReader(scope) {
    catalogueReadScope = scope;
    if (scope) {
        void refreshCounts();
        if (!pageStarted) void fetchPage(currentPageRequest);
    } else {
        ++countVersion;
        ++catalogueWorkspaceQueryVersion;
        catalogueWorkspaceProducts = [];
        catalogueCounts = null;
        cataloguePageStatus = 'blocked';
        catalogueNext = cataloguePrevious = null;
        pageStarted = false;
        sendCatalogueWorkspaceData();
    }
}

let catalogueAccessIssue = false;
let catalogueCompanyAccess;
let catalogueBuyerCompanyId = '';
function selectedCatalogueScope() {
    return selectionContext?.assistCustomerId || (catalogueBuyerCompanyId ? { buyerCompanyId: catalogueBuyerCompanyId } : '');
}
function sendCatalogueCompanies() {
    if (!catalogueCompanyAccess) return;
    try { $w('#html5').postMessage({ type: 'BUYER_COMPANY_ACCESS', ...catalogueCompanyAccess }); } catch (_) {}
}
async function denyCatalogueCompanyAccess() {
    setReader(null);
    catalogueAccessIssue = true;
    selectionContext = null;
    catalogueCompanyAccess = { companies: [], blocked: true, denied: true };
    try { catalogueCompanyAccess.companies = (await getBuyerCompanies()).companies; } catch (_) { /* Keep the workspace blocked. */ }
    sendCatalogueCompanies();
}
function reportCatalogueAccess(message, blocked = true) {
    catalogueAccessIssue = blocked;
    try { $w('#text19').text=message?'Access unavailable':String(catalogueContextMessage?.sheetName||'Catalogue'); } catch (_) {}
    try { $w('#text20').text=message||String(catalogueContextMessage?.signedInName||''); } catch (_) {}
    try { if(blocked)$w('#html5').collapse();else $w('#html5').expand(); } catch (_) {}
}
async function loadSelectionState(assistCustomerId = '') {
    const pendingAtReadStart = new Set([...joinedMobileSelections].filter(productId =>
        readMobileSelectionFlight(mobileSelectionFlightKey(productId))?.expiresAt > Date.now()));
    const state = await getCatalogueSelectionState(assistCustomerId);
    sidebarSelectionState(state);
    if(state?.ok) reportCatalogueAccess('', false);
    if (state?.ok && selectionContext?.mode === 'buyer' && catalogueBrowseKey === 'catalogueBrowseReturnV1:' + state.customerId) {
        for (const productId of joinedMobileSelections) {
            const saved = activeSelectedProductIds.has(productId);
            const flight = readMobileSelectionFlight(mobileSelectionFlightKey(productId));
            if (!saved && (pendingAtReadStart.has(productId) || flight?.expiresAt > Date.now())) continue;
            joinedMobileSelections.delete(productId);
            selectionBusyIds.delete(productId);
            $w('#html5').postMessage({ type: 'catalogueWorkspaceSelection', ok: saved, productId });
        }
    }
    return state;
}

function getCatalogueAssistCustomerId() {
    const fromQuery = String(wixLocationFrontend.query?.assist || '').trim();
    if (fromQuery) return fromQuery;
    try { return (new URL(wixLocationFrontend.url).searchParams.get('assist') || '').trim(); }
    catch (_) { return ''; }
}

function goToCatalogueStaffLogin(customerId) {
    const next = '/catalogue?assist=' + encodeURIComponent(customerId);
    wixLocationFrontend.to('/sales-room-login?next=' + encodeURIComponent(next));
}

$w.onReady(() => {
    if (wixWindowFrontend.rendering?.env === 'backend') return;
    void (async () => {
    const contextStarted = Date.now();
    const assistCustomerId = getCatalogueAssistCustomerId();
    const assistedSelection = assistCustomerId ? getCatalogueSelectionState(assistCustomerId).catch(() => null) : null;
    let staff;
    try { staff = await getCurrentStaffContext(); } catch (error) { staff = null; }

    if (staff?.authorized) {
        if (staff.customerScope?.pages && !staff.customerScope.pages.includes('CATALOGUE')) { reportCatalogueAccess('Staff Management does not allow Catalogue access.'); return; }
        if (assistCustomerId) {
            try {
                const selection = await assistedSelection;
                if (!selection?.ok || selection.customerId !== assistCustomerId) {
                    throw new Error('Catalogue customer access could not be verified.');
                }
                try { session.setItem('catalogueAssistCustomerId', selection.customerId); } catch (_) {}
                selectionContext = { mode: staff.canViewAllCustomers ? 'admin' : 'assist', assistCustomerId: selection.customerId, staffId: staff.staffId };
                sidebarSelectionState(selection);
                assistedContextMs = Date.now() - contextStarted;
                setReader({ assistCustomerId: selection.customerId });
                sendCatalogueContext({
                    type: 'catalogueContext', mode: staff.canViewAllCustomers ? 'admin' : 'assist',
                    sheetName: String(selection.companyName || selection.customerId).trim(),
                    signedInName: String(staff.staffName || staff.staffId || '').trim()
                });
            } catch (error) {
                try { session.removeItem('catalogueAssistCustomerId'); } catch (_) {}
                if (!authentication.loggedIn()) goToCatalogueStaffLogin(assistCustomerId);
                else reportCatalogueAccess('Staff Management could not authorize this customer Catalogue.');
                return;
            }
        } else {
            session.removeItem('catalogueAssistCustomerId');
            selectionContext = null;
            catalogueSelectionResolved = true;
            setReader({ staffPreview: true });
            sendCatalogueContext({ type: 'catalogueContext', mode: 'preview', signedInName: String(staff.staffName || staff.staffId || '').trim() });
        }
        return;
    }

    if (assistCustomerId) {
        if (wixWindowFrontend.viewMode === 'Site' && (!authentication.loggedIn() || staff?.reason === 'NOT_LOGGED_IN')) {
            goToCatalogueStaffLogin(assistCustomerId);
        } else {
            reportCatalogueAccess('Staff Management could not authorize this customer Catalogue.');
        }
        return;
    }

    const hasBuyerAccess = local.getItem('catalogueAccess') === 'granted' || session.getItem('catalogueAccess') === 'granted';
    const signedIn = authentication.loggedIn();
    if (!hasBuyerAccess && !signedIn && wixWindowFrontend.viewMode === 'Site') { wixLocationFrontend.to('/'); return; }
    if (hasBuyerAccess || signedIn) {
        const requestedCompanyId = selectedBuyerCompanyId(wixLocationFrontend);
        try {
            catalogueCompanyAccess = await loadBuyerCompanyAccess(getBuyerCompanies, requestedCompanyId);
            sendCatalogueCompanies();
            if (catalogueCompanyAccess.blocked) return;
            if (catalogueCompanyAccess.scoped) catalogueBuyerCompanyId = catalogueCompanyAccess.currentId;
            selectionContext = { mode: 'buyer', assistCustomerId: '' };
            const state = await loadSelectionState(selectedCatalogueScope());
            if (state?.ok !== true || !state.customerId) throw new Error('Customer Catalogue access could not be verified.');
            sendCatalogueContext({
                type: 'catalogueContext', mode: 'buyer',
                sheetName: String(state?.companyName || 'Buyer Account').trim(),
                signedInName: String(state?.actorName || 'Buyer').trim()
            });
            await restoreMobileCataloguePosition(state.customerId);
            setReader({ buyerCompanyId: state.customerId });
        } catch (error) {
            if (requestedCompanyId || catalogueBuyerCompanyId) { await denyCatalogueCompanyAccess(); return; }
            selectionContext = null;
            local.removeItem('catalogueAccess');
            session.removeItem('catalogueAccess');
            if (wixWindowFrontend.viewMode === 'Site') {
                if (hasBuyerAccess) wixLocationFrontend.to('/buyer-room');
                else reportCatalogueAccess('This account has no customer Catalogue access. Contact your administrator.');
            }
        }
    }
    let selectionRefreshPending = false;
    setInterval(async () => {
        if (!selectionContext || selectionRefreshPending) return;
        selectionRefreshPending = true;
        try { await loadSelectionState(selectedCatalogueScope()); }
        catch (error) {
            if (catalogueBuyerCompanyId) { await denyCatalogueCompanyAccess(); return; }
            const expiredAssistCustomerId = String(selectionContext?.assistCustomerId || session.getItem('catalogueAssistCustomerId') || '').trim();
            if (expiredAssistCustomerId) {
                if(!authentication.loggedIn())wixLocationFrontend.to('/sales-room-login?next='+encodeURIComponent('/catalogue?assist='+expiredAssistCustomerId));
                else { const denied=/permission|not authorized|authorization is required|suspended|not found|not ready/i.test(error?.message||''); reportCatalogueAccess(denied?'Staff Management does not allow this customer Catalogue.':'Access is temporarily unavailable. The system is checking again.',denied); }
                return;
            }
            selectionContext = null;
            setReader(null);
            selectedProductIds = new Set();
            activeSelectedProductIds = new Set();
            removedProductIds = new Set();
            local.removeItem('catalogueAccess');
            session.removeItem('catalogueAccess');
            if (wixWindowFrontend.viewMode === 'Site') wixLocationFrontend.to(expiredAssistCustomerId ? '/sales-room' : '/buyer-room');
        } finally { selectionRefreshPending = false; }
    }, 15000);
    })().catch(error => console.error('Catalogue identity initialization failed', error));
});

async function loadMenuData() {
    try {
        const result = await wixData.query('subCategories').ascending('mainCategory').ascending('title').fields('_id', 'mainCategory', 'title').limit(1000).find();
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
    const workspace = $w('#html5');
    let nativeSearch;
    try { nativeSearch = $w('#input2'); } catch (error) {
        try { nativeSearch = $w('#input1'); } catch (fallbackError) { nativeSearch = null; }
    }
    let activeMain = 'FOOD';
    let menuAnchor = 12;
    let isOpen = false;
    let lastScrollY = null;
    let scrollCheckPending = false;
    let leaveTimer;

    const setWorkspaceMenuState = (open) => {
        try { $w('#html5').postMessage({ type: 'catalogueWorkspaceMenuState', open: Boolean(open) }); } catch (error) {}
    };

    const showMenu = async (main = activeMain, anchor) => {
        clearTimeout(leaveTimer);
        activeMain = main;
        menuAnchor = Number.isFinite(anchor) ? Math.max(12, Math.min(3000, anchor)) : 12;
        if (!isOpen) await mega.expand();
        isOpen = true;
        setWorkspaceMenuState(true);
        mega.postMessage({ type: 'showMain', main: activeMain, anchor: menuAnchor });
        setTimeout(() => {
            if (!isOpen) return;
            if (catalogueMenuMessage) mega.postMessage(catalogueMenuMessage);
            mega.postMessage({ type: 'showMain', main: activeMain, anchor: menuAnchor });
        }, 250);
        header.postMessage({ type: 'megaState', open: true, main: activeMain });
    };

    const hideMenu = async () => {
        clearTimeout(leaveTimer);
        if (!isOpen) return;
        setWorkspaceMenuState(false);
        await mega.collapse();
        isOpen = false;
        header.postMessage({ type: 'megaState', open: false, main: activeMain });
    };

    const applySearch = raw => showView({ query: String(raw || '').trim().slice(0, 120) });

    // The search control is a Wix element in the same section as the header.
    // It filters the existing CMS-backed catalogue without relying on iframe sizing.
    let searchTimer;
    if (nativeSearch) {
        nativeSearch.placeholder = 'Search products, brands or categories...';
        nativeSearch.expand();
        nativeSearch.show();
        nativeSearch.onInput(() => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => applySearch(nativeSearch.value), 240);
        });
    }

    const applyMainCategory = async main => {
        const items = catalogueMenuMessage && Array.isArray(catalogueMenuMessage.items)
            ? catalogueMenuMessage.items
            : [];
        const ids = items
            .filter(item => String(item.mainCategory || '').toUpperCase() === String(main || '').toUpperCase())
            .map(item => item.id)
            .filter(Boolean);
        if (ids.length) {
            await showView({ subIds: ids });
        }
    };

    const resetCatalogueHome = async () => {
        clearTimeout(searchTimer);
        if (nativeSearch) nativeSearch.value = '';
        header.postMessage({ type: 'catalogueHeaderFilter', query: '' });
        void hideMenu().catch(error => console.error('Catalogue menu could not close', error));
        void wixWindowFrontend.scrollTo(0, 0).catch(() => {});
        const revision = catalogueBrowseRevision;
        await menuReady;
        if (revision !== catalogueBrowseRevision) return;
        const foodIds = (catalogueMenuMessage?.items || []).filter(item => item.mainCategory === 'FOOD').map(item => item.id);
        if (foodIds.length) await showView({ subIds: foodIds });
        else { ++catalogueWorkspaceQueryVersion; catalogueWorkspaceProducts = []; cataloguePageStatus = 'failed'; sendCatalogueWorkspaceData(); }
    };
    $w('#imageX38').onClick(() => {
        resetCatalogueHome().catch(error => console.error('Catalogue home could not be opened', error));
    });

    header.onMessage(async (event) => {
        const message = event.data || {};
        if (message.type === 'catalogueOpenAccountMenu') {
            openCatalogueAccountMenu(workspace);
            return;
        }
        if (message.type === 'catalogueHeaderReady') {
            if (catalogueContextMessage) header.postMessage(catalogueContextMessage);
            if (catalogueMenuMessage) mega.postMessage(catalogueMenuMessage);
        } else if (message.type === 'catalogueMain') {
            if (wixWindowFrontend.formFactor === 'Mobile') {
                await hideMenu();
                await applyMainCategory(message.main);
                header.postMessage({ type: 'megaState', open: false, main: message.main });
            } else {
                message.open ? showMenu(message.main, message.anchor) : hideMenu();
            }
        } else if (message.type === 'catalogueMegaLeave') {
            leaveTimer = setTimeout(hideMenu, 420);
        } else if (message.type === 'catalogueMobileCategories') {
            workspace.postMessage({ type: 'catalogueMobileCategories', open: message.open === true });
        } else if (message.type === 'catalogueSearch') {
            await applySearch(message.query);
        } else if (message.type === 'catalogueHome') {
            await resetCatalogueHome();
        } else if (message.type === 'catalogueAll') {
            await hideMenu();
            if (nativeSearch) nativeSearch.value = '';
            await showView();
            publishCatalogueSearchValue();
        } else if (message.type === 'catalogueAccount') {
            await signOutCatalogue();
        } else if (message.type === 'catalogueBuyerRoom') {
            openBuyerRoomWindow();
        }
    });

    mega.onMessage(async (event) => {
        const message = event.data || {};
        if (message.type === 'catalogueMegaReady') {
            if (catalogueMenuMessage) mega.postMessage(catalogueMenuMessage);
            if (isOpen) mega.postMessage({ type: 'showMain', main: activeMain, anchor: menuAnchor });
        } else if (message.type === 'catalogueRequestPrinciples') {
            try {
                const items = await getPrinciplesForSub(message.id);
                mega.postMessage({ type: 'cataloguePrinciples', id: message.id, requestId: message.requestId, items });
            } catch (error) {
                console.error('Catalogue principle lookup failed', error);
                mega.postMessage({ type: 'cataloguePrinciples', id: message.id, requestId: message.requestId, items: [] });
            }
        } else if (message.type === 'catalogueMegaClose') {
            await hideMenu();
        } else if (message.type === 'catalogueMegaEnter') {
            clearTimeout(leaveTimer);
        } else if (message.type === 'catalogueMegaLeave') {
            leaveTimer = setTimeout(hideMenu, 420);
        } else if (message.type === 'catalogueSub') {
            const id = message.id || catalogueMenuMessage?.items.find(item => item.title === message.sub)?.id;
            if (id) await showView({ subIds: [id] });
            hideMenu();
        } else if (message.type === 'catalogueGroup') {
            const requestedIds = new Set(Array.isArray(message.ids) ? message.ids : []);
            const ids = (catalogueMenuMessage?.items || []).map(item => item.id).filter(id => requestedIds.has(id));
            if (ids.length) await showView({ subIds: ids });
            hideMenu();
        } else if (message.type === 'cataloguePrinciple') {
            const principle = String(message.principle || '').trim();
            if (!principle) return;
            await showView({ principle, subIds: message.subId ? [message.subId] : [] });
            hideMenu();
        }
    });

    setWorkspaceMenuState(false);
    mega.collapse();
    const menuReady = loadMenuData();
    setInterval(async () => {
        if (!isOpen) { lastScrollY = null; return; }
        if (scrollCheckPending) return;
        scrollCheckPending = true;
        try {
            const currentY = (await wixWindowFrontend.getBoundingRect()).scroll.y;
            if (isOpen && lastScrollY !== null && currentY - lastScrollY > 8 && currentY > 160) hideMenu();
            lastScrollY = currentY;
        } finally { scrollCheckPending = false; }
    }, 180);
    return hideMenu;
}

function setupCatalogueWorkspace(hideDesktopMenu) {
    const workspace = $w('#html5');
    catalogueAccountSession = connectAccountSession([$w('#html3'), $w('#html4'), workspace], '/');
    workspace.onMessage(async (event) => {
        const message = event.data || {};
        if (message.type === 'catalogueAccountMenuReady') {
            catalogueAccountMenuReady = true;
            if (catalogueAccountMenuRequested) openCatalogueAccountMenu(workspace);
            return;
        }
        if (message.type === 'catalogueAccount') {
            await signOutCatalogue();
            return;
        }
        if (message.type === 'catalogueAccountSignIn') {
            wixLocationFrontend.to('/');
            return;
        }
        if (message.type === 'BUYER_COMPANY_SWITCH') {
            if (catalogueCompanyAccess?.companies.some(company => company.customerId === message.customerId)) {
                wixLocationFrontend.to(buyerCompanyPath('/catalogue', message.customerId));
            }
            return;
        }
        if (message.type === 'catalogueWorkspaceReady') {
            const instanceId = typeof message.instanceId === 'string' ? message.instanceId : '';
            if (instanceId && instanceId === catalogueWorkspaceInstance) return;
            catalogueWorkspaceInstance = instanceId;
            catalogueWorkspaceReady = true;
            thumbnailWorkspace = message.deferredThumbnails === true;
            sendCatalogueCompanies();
            sendCatalogueWorkspaceData();
            if (!pageStarted) await fetchPage(currentPageRequest);
            if (catalogueMenuMessage) workspace.postMessage(catalogueMenuMessage);
            if (catalogueBuyerNavigationPending) workspace.postMessage({ type: 'cataloguePrepareBuyerRoom' });
        } else if (message.type === 'catalogueWorkspaceDismissMenu') {
            await hideDesktopMenu();
        } else if (message.type === 'catalogueMobileCategoriesState') {
            $w('#html3').postMessage({ type: 'catalogueMobileCategoriesState', open: message.open === true, returnFocus: message.returnFocus === true });
        } else if (message.type === 'catalogueWorkspaceBrowse') {
            const principle = typeof message.principle === 'string' ? message.principle.trim() : '';
            const main = typeof message.main === 'string' ? message.main.toUpperCase() : '';
            const subId = typeof message.subId === 'string' ? message.subId : '';
            const nonFood = message.scope === 'NON_FOOD';
            const categories = (catalogueMenuMessage?.items || []).filter(item =>
                nonFood ? NON_FOOD_CATEGORY_KEYS.has(item.mainCategory) : item.mainCategory === main);
            if (((main || nonFood) && !categories.length) || (subId && !categories.some(item => item.id === subId))) return;
            try { $w('#input2').value = ''; } catch (error) {}
            if (main || nonFood) {
                const ids = subId ? [subId] : categories.map(item => item.id);
                await showView({ subIds: ids });
                publishCatalogueSearchValue();
                return;
            }
            await showView({ principle });
            publishCatalogueSearchValue();
        } else if (message.type === 'catalogueSelectionView') {
            const view = message.view;
            if (!['', 'FOOD', 'NON_FOOD', 'ALL'].includes(view)) return;
            if (!catalogueWorkspaceFilter.selectionView) selectionReturnFilter = catalogueWorkspaceFilter;
            await showView(view ? { selectionView: view } : selectionReturnFilter);
        } else if (message.type === 'catalogueTurnPage' && message.version === catalogueWorkspaceQueryVersion) {
            const direction = message.direction;
            if (direction === 'retry' && cataloguePageStatus === 'failed') await fetchPage(currentPageRequest);
            if (cataloguePageStatus !== 'ready') return;
            const cursor = direction === 'next' ? catalogueNext : direction === 'previous' ? cataloguePrevious : null;
            if (cursor !== null) {
                recordCatalogueBrowse(catalogueBrowseSubIds);
                await fetchPage({ afterId: cursor }, direction === 'previous' ? 'last' : 'first');
            }
        } else if (message.type === 'catalogueDetailRequest') {
            const version = catalogueWorkspaceQueryVersion, scope = catalogueReadScope;
            const id = message.id;
            if (!scope || version !== message.version || !catalogueWorkspaceProducts.some(product => product.id === id)) return;
            let product = null;
            try { product = await readCatalogueProduct(scope, id); } catch (_) {}
            if (scope === catalogueReadScope && version === catalogueWorkspaceQueryVersion) {
                workspace.postMessage({ type: 'catalogueDetailResult', version, id, product });
            }
        } else if (message.type === 'catalogueThumbnailRequest') {
            const version = catalogueWorkspaceQueryVersion, scope = catalogueReadScope;
            const { ids, requestId } = message;
            if (!scope || !thumbnailWorkspace || cataloguePageStatus !== 'ready' || version !== message.version ||
                !Number.isSafeInteger(requestId) || !Array.isArray(ids) || !ids.length || ids.length > 10 ||
                !ids.every(id => catalogueWorkspaceProducts.some(product => product.id === id))) return;
            let images = [];
            try { images = await readCatalogueThumbnails(scope, ids); } catch (_) { /* Keep the list usable. */ }
            if (scope === catalogueReadScope && version === catalogueWorkspaceQueryVersion) {
                workspace.postMessage({ type: 'catalogueThumbnailResult', version, requestId, images });
            }
        } else if (message.type === 'catalogueWorkspacePosition') {
            rememberMobileCataloguePosition(message);
        } else if (message.type === 'catalogueWorkspaceNavigate') {
            try { await wixWindowFrontend.scrollTo(0, 0); } catch (error) {}
        } else if (message.type === 'catalogueWorkspaceOpenRemoved') {
            if (removedProductIds.has(String(message.productId || ''))) openBuyerRoomWindow();
        } else if (message.type === 'catalogueWorkspaceBuyerRoom') {
            if (!catalogueBuyerNavigationPending) return;
            catalogueBuyerNavigationPending = false;
            openBuyerRoom();
        } else if (message.type === 'catalogueWorkspaceSelect') {
            const productId = String(message.productId || '').trim();
            if (!productId || selectionBusyIds.has(productId)) return;
            const context = selectionContext;
            if (!context) {
                workspace.postMessage({ type: 'catalogueWorkspaceSelection', ok: false, productId });
                return;
            }
            if (selectedProductIds.has(productId)) {
                const wasRemoved = removedProductIds.has(productId);
                workspace.postMessage({ type: 'catalogueWorkspaceSelection', ok: !wasRemoved, productId });
                if (wasRemoved) sendCatalogueWorkspaceData();
                return;
            }
            selectionBusyIds.add(productId);
            const flightKey = mobileSelectionFlightKey(productId);
            if (readMobileSelectionFlight(flightKey)?.expiresAt > Date.now()) {
                joinedMobileSelections.add(productId);
                return;
            }
            const flightOwner = claimMobileSelectionFlight(flightKey);
            try {
                const result = await addCatalogueSelection(productId, selectedCatalogueScope());
                if (!result?.ok) throw new Error(result?.error || 'Could not save this selection.');
                if (selectionContext !== context) return;
                selectedProductIds.add(productId);
                activeSelectedProductIds.add(productId);
                removedProductIds.delete(productId);
                catalogueSelectionTotal = activeSelectedProductIds.size;
                void refreshCounts();
                workspace.postMessage({ type: 'catalogueWorkspaceSelection', ok: true, productId });
                sendCatalogueWorkspaceData();
            } catch (error) {
                console.error('Catalogue workspace selection failed', error);
                if (selectionContext !== context) return;
                if (catalogueBuyerCompanyId && /no longer available|not linked/.test(error?.message || '')) {
                    await denyCatalogueCompanyAccess();
                    return;
                }
                try {
                    const state = await getCatalogueSelectionState(selectedCatalogueScope());
                    if (selectionContext !== context) return;
                    if (state?.ok && (state.removedProductIds || []).includes(productId)) {
                        workspace.postMessage({ type: 'catalogueWorkspaceSelection', ok: false, productId });
                        sidebarSelectionState(state);
                        return;
                    }
                    if (state?.ok && (state.activeSelectedProductIds || []).includes(productId)) {
                        sidebarSelectionState(state);
                        workspace.postMessage({ type: 'catalogueWorkspaceSelection', ok: true, productId });
                        return;
                    }
                } catch (readError) {
                    console.warn('Catalogue selection status could not be confirmed', readError);
                }
                workspace.postMessage({ type: 'catalogueWorkspaceSelection', ok: false, productId });
            } finally {
                releaseMobileSelectionFlight(flightKey, flightOwner);
                selectionBusyIds.delete(productId);
            }
        }
    });
}

function openBuyerRoom() {
    if(catalogueAccessIssue)return;
    if (catalogueContextMessage?.mode === 'preview') {
        wixLocationFrontend.to('/sales-room');
        return;
    }
    const assistCustomerId = String(selectionContext?.assistCustomerId || '').trim();
    if (catalogueContextMessage?.mode !== 'buyer' && !assistCustomerId) return;
    if (assistCustomerId && selectionContext?.staffId) {
        try {
            session.setItem('staffBuyerEntryV1', JSON.stringify({ customerId: assistCustomerId, staffId: selectionContext.staffId, expiresAt: Date.now() + 30000 }));
        } catch (error) { /* The explicit URL still carries the authorized customer. */ }
    }
    wixLocationFrontend.to(assistCustomerId ? '/buyer-room?assist=' + encodeURIComponent(assistCustomerId) : buyerCompanyPath('/buyer-room', catalogueBuyerCompanyId));
}

function buyerRoomUrl(mode = catalogueContextMessage?.mode) {
    const preview = mode === 'preview';
    const url = new URL(preview ? 'sales-room' : 'buyer-room', new URL('.', wixLocationFrontend.url));
    if (preview) return url.href;
    const assistCustomerId = String(selectionContext?.assistCustomerId || '').trim();
    if (assistCustomerId) url.searchParams.set('assist', assistCustomerId);
    else if (catalogueBuyerCompanyId) url.searchParams.set('company', catalogueBuyerCompanyId);
    return url.href;
}

function openBuyerRoomWindow() {
    if (!catalogueContextMessage || catalogueBuyerNavigationPending) return;
    if (catalogueContextMessage.mode === 'preview') { openBuyerRoom(); return; }
    catalogueBuyerNavigationPending = true;
    try { $w('#html3').postMessage({ type: 'catalogueBuyerRoomPending', pending: true }); } catch (error) {}
    if (catalogueWorkspaceReady) $w('#html5').postMessage({ type: 'cataloguePrepareBuyerRoom' });
}

function setupFluidCatalogueLayout() {
    const classMap = [
        ['#section12', 'catalogue-native-masthead'],
        ['#imageX38', 'catalogue-home-logo'],
        ['#section7', 'catalogue-navigation-stage'],
        ['#html4', 'catalogue-compact-menu'],
        ['#section6', 'catalogue-results-stage']
    ];

    classMap.forEach(([selector, className]) => {
        // @ts-ignore - selectors are validated by the fixed map above.
        try { $w(selector).customClassList.add(className); }
        catch (error) { console.warn(`Catalogue layout class failed for ${selector}`, error); }
    });

    // #html5 is the only visible Catalogue surface. The legacy card repeater
    // and pagination have been removed from the Wix page.
    try { $w('#box20').expand(); } catch (error) {}
    try { $w('#html5').expand(); } catch (error) {}
}

$w.onReady(() => {
    setupFluidCatalogueLayout();
    if (wixWindowFrontend.rendering?.env === 'backend') return;
    setupCatalogueWorkspace(setupNav());
});

// This temporary owner view resumes the server-side cursor. The backend web
// method independently requires a Wix administrator on every batch call.
$w.onReady(async () => {
    if (wixWindowFrontend.rendering?.env !== 'browser' ||
        wixLocationFrontend.query?.adminCatalogueImageMigration !== '1') return;
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    let errors = 0;
    try { await cataloguePictureProgress(); } catch { return; }
    while (errors < 3) {
        try {
            const batch = await continueCataloguePictures();
            errors = 0;
            if (!batch || !['MIGRATING','BUSY','FINISHED'].includes(batch.status)) break;
            const progress = batch.totals || {};
            const verified = Number(progress.VERIFIED || 0);
            const review = Object.entries(progress).reduce((total,[id,count]) => id==='VERIFIED' ? total : total+count, 0);
            $w('#text19').text = 'Private image migration';
            $w('#text20').text = (batch.status === 'FINISHED' ? 'Completed' : 'Running') +
                ' · ' + verified + ' verified · ' + review + ' to review';
            if (batch.status === 'FINISHED') return;
            await delay(batch.status === 'BUSY' ? 4500 : 1200);
        } catch {
            errors++;
            $w('#text20').text = 'Checking the saved migration position…';
            if (errors < 3) await delay(15000 * errors);
        }
    }
    $w('#text20').text = 'Paused · Refresh to resume from the saved position';
});
