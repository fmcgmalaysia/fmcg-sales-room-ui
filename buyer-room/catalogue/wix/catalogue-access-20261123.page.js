import { connectAccountSession } from 'public/wix-account-session.js';
import { authentication } from 'wix-members-frontend';
import wixLocationFrontend from 'wix-location-frontend';
import { local, session } from 'wix-storage-frontend';
import wixWindowFrontend from 'wix-window-frontend';
import wixData from 'wix-data';

import { getCurrentStaffContext } from 'backend/staffAuth.web.js';
import { addCatalogueSelection, getCatalogueSelectionState } from 'backend/catalogueSelection.web.js';
import { getBuyerCompanies } from 'backend/catalogueAuth.web.js';
import { readCatalogue927, listCataloguePrinciples } from 'backend/protectedCatalogue.web.js';
import { cataloguePictureProgress, continueCataloguePictures } from 'backend/cataloguePhotoMigrationAdmin.web.js';
import { loadBuyerCompanyAccess, buyerCompanyPath, selectedBuyerCompanyId } from 'public/buyerCompanyNavigation.js';

let catalogueContextMessage = null;
let catalogueAccountSession;
let catalogueAccountMenuReady = false;
let catalogueAccountMenuRequested = false;

function openCatalogueAccountMenu(header) {
    if (catalogueOpeningStartedAt) return;
    if (!catalogueAccountMenuReady) {
        catalogueAccountMenuRequested = true;
        return;
    }
    catalogueAccountMenuRequested = false;
    $w('#section7').customClassList.add('catalogue-account-open');
    header.postMessage({
        type: 'catalogueAccountMenu',
        signedIn: authentication.loggedIn(),
        canViewSelection: catalogueContextMessage?.mode === 'buyer' || Boolean(selectionContext?.assistCustomerId)
    });
}

function signOutCatalogue() {
    return catalogueAccountSession.signOut(() => {
        try { session.removeItem(CATALOGUE_OPENING_SEEN); } catch (error) {}
        resetCatalogueReader();
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
const CATALOGUE_BUILD_VERSION = '20261127-catalogue-927-restore-v1';
const CATALOGUE_OPENING_SEEN = 'catalogueOpeningSeenV1';
const CATALOGUE_OPENING_MAX_MS = 20000;
let catalogueOpeningStartedAt = 0;
let catalogueOpeningTimer;
const joinedMobileSelections = new Set();
const MOBILE_SELECTION_FLIGHT_MS = 120000;
const NON_FOOD_CATEGORY_KEYS = new Set(['HOUSEHOLDS', 'PERSONAL CARE', 'OTHERS']);
let catalogueWorkspaceProducts = [];
let catalogueWorkspaceAllProducts = [];
let catalogueWorkspaceReady = false;
let catalogueWorkspaceInstance = '';
let lastWorkspaceProducts = null;
let lastWorkspaceCategoryMap = null;
let lastWorkspaceCategoriesLoaded;
let catalogueSelectionLimit = 100;
let catalogueSelectionTotal = 0;
let catalogueWorkspaceFilter = { query: '', main: '', subIds: [], principle: '' };
let catalogueSubCategoryMainMap = new Map();
let catalogueFoodProductIds = new Set();
let catalogueFoodPrinciples = new Set();
let catalogueProductsLoaded = false;
let catalogueWorkspaceRead = null;
let catalogueRestoreScope;
let cataloguePreparedFirst;
let catalogueWorkspaceFullReadComplete = false;
let catalogueCategoriesLoaded = false;
let catalogueSelectionResolved = false;
let catalogueWorkspaceQueryVersion = 0;
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
    if (subIds.length) {
        showCatalogueCachedView({ subIds }, { anchor, offset });
        return;
    }
    if (catalogueWorkspaceQueryVersion !== 0) return;
    catalogueWorkspaceFilter = { query, main: '', subIds: [], principle };
    recordCatalogueBrowse([], { anchor, offset });
    if (query) {
        try { $w('#input2').value = query; } catch (error) {}
    }
    publishCatalogueSearchValue();
    sendCatalogueWorkspaceData();
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
    const scope = catalogueRestoreScope;
    if (!scope) return [];
    const names = catalogueWorkspaceFullReadComplete
        ? catalogueWorkspaceAllProducts.filter(product => product.subCategoryIds.includes(subId)).map(product => product.principle).filter(Boolean)
        : await listCataloguePrinciples(scope, subId);
    if (scope !== catalogueRestoreScope) return [];
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
    sendCatalogueWorkspaceData();
}

function catalogueReferenceIds(value) {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    return values.map(entry => String(entry?._id || entry || '').trim()).filter(Boolean);
}

function catalogueUnitPrice(item) {
    const candidates = [item.unitPrice, item.pricePerUnit];
    const value = candidates.map(Number).find(number => Number.isFinite(number) && number > 0);
    return value || null;
}

function catalogueProductRecord(item) {
    return {
        id: String(item?._id || ''),
        name: String(item?.name || item?.title || '').trim(),
        description: String(item?.description || item?.packingSize || '').trim(),
        // The Catalogue CMS field labelled "EA" still uses the legacy key
        // `price`. Keep it separate from indicative unit-price fields.
        ea: String(item?.ea ?? item?.EA ?? item?.price ?? '').trim(),
        barcode: String(item?.barcode || item?.unitBarcode || '').trim(),
        innerBoxBarcode: String(item?.innerBoxBarcode || '').trim(),
        cartonBarcode: String(item?.cartonBarcode || '').trim(),
        cbmPerCtn: String(item?.m3Ctn ?? item?.cbmPerCtn ?? item?.cbm ?? '').trim(),
        principle: String(item?.principle || '').trim(),
        brandName: String(item?.brandName || '').trim(),
        mainCategory: String(item?.mainCategory || '').trim().toUpperCase(),
        image: imageUrl(item?.image),
        countryOrigin: String(item?.countryOrigin || '').trim(),
        shelfLife: String(item?.shelflife || item?.shelfLife || '').trim(),
        sortNo: item?.pointBaseSortId ?? item?.sortNo ?? item?.sortNO ?? item?.sortNumber ?? item?.sortOrder ?? '',
        subCategoryIds: catalogueReferenceIds(item?.subCategories),
        unitPrice: catalogueUnitPrice(item),
        currency: String(item?.currency || 'USD').trim().toUpperCase()
    };
}

function sortCatalogueProducts(items) {
    const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    return items
        .map((item, index) => ({ item, index }))
        .sort((left, right) => {
            const leftBrand = String(left.item.brandName || '').trim();
            const rightBrand = String(right.item.brandName || '').trim();
            if (!leftBrand && rightBrand) return 1;
            if (leftBrand && !rightBrand) return -1;
            const brandOrder = collator.compare(leftBrand, rightBrand);
            if (brandOrder) return brandOrder;
            const leftRaw = String(left.item.sortNo ?? '').trim();
            const rightRaw = String(right.item.sortNo ?? '').trim();
            if (!leftRaw && !rightRaw) return left.index - right.index;
            if (!leftRaw) return 1;
            if (!rightRaw) return -1;
            const leftNumber = Number(leftRaw);
            const rightNumber = Number(rightRaw);
            const order = Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
                ? leftNumber - rightNumber
                : collator.compare(leftRaw, rightRaw);
            return order || left.index - right.index;
        })
        .map(entry => entry.item);
}

function catalogueMainCategory(product) {
    if (catalogueFoodProductIds.has(product.id) || catalogueFoodPrinciples.has(product.principle.toUpperCase())) return 'FOOD';
    return (product.subCategoryIds || [])
        .map(subCategoryId => catalogueSubCategoryMainMap.get(String(subCategoryId)))
        .find(Boolean) || product.mainCategory || '';
}

function catalogueSelectionSummary() {
    const allById = new Map(catalogueWorkspaceAllProducts.map(product => [product.id, product]));
    const selectedProducts = sortCatalogueProducts([...activeSelectedProductIds].map(id => allById.get(id)).filter(Boolean));
    const food = selectedProducts.filter(product => catalogueMainCategory(product).startsWith('FOOD')).length;
    const total = activeSelectedProductIds.size;
    return {
        total,
        food,
        nonFood: Math.max(0, total - food),
        products: selectedProducts.map(product => ({ ...product, mainCategory: catalogueMainCategory(product) }))
    };
}

function sendCatalogueWorkspaceData() {
    if (!catalogueWorkspaceReady) return;
    try {
        const refreshProducts = !catalogueWorkspaceInstance || catalogueWorkspaceProducts !== lastWorkspaceProducts ||
            catalogueSubCategoryMainMap !== lastWorkspaceCategoryMap ||
            catalogueCategoriesLoaded !== lastWorkspaceCategoriesLoaded;
        const selection = catalogueSelectionSummary();
        $w('#html5').postMessage({
            type: 'catalogueWorkspaceData',
            ...(refreshProducts ? { products: catalogueWorkspaceProducts.map(product => ({
                ...product,
                mainCategory: catalogueMainCategory(product)
            })) } : {}),
            selectedProductIds: [...selectedProductIds],
            activeSelectedProductIds: [...activeSelectedProductIds],
            removedProductIds: [...removedProductIds],
            selectionProducts: selection.products,
            selectionLimit: catalogueSelectionLimit,
            selectionTotal: selection.total,
            selectionFoodCount: selection.food,
            selectionNonFoodCount: selection.nonFood,
            selectionCountsReady: catalogueProductsLoaded && catalogueCategoriesLoaded && catalogueSelectionResolved,
            selectionReady: catalogueSelectionResolved && Boolean(selectionContext),
            catalogueStatus: catalogueWorkspaceFullReadComplete ? '' :
                (catalogueWorkspaceFilter.homeState === 'failed' ? 'failed' : 'loading'),
            opening: catalogueOpeningStartedAt ? {
                startedAt: catalogueOpeningStartedAt,
                ready: catalogueOpeningDataReady()
            } : null,
            buyerRoomUrl: buyerRoomUrl(),
            context: catalogueContextMessage,
            buildVersion: CATALOGUE_BUILD_VERSION
        });
        lastWorkspaceProducts = catalogueWorkspaceProducts;
        lastWorkspaceCategoryMap = catalogueSubCategoryMainMap;
        lastWorkspaceCategoriesLoaded = catalogueCategoriesLoaded;
        $w('#html5').postMessage(workspaceFilterMessage());
    } catch (error) {}
}

function catalogueOpeningDataReady() {
    return (catalogueWorkspaceProducts.length > 0 || catalogueWorkspaceFullReadComplete) && catalogueCategoriesLoaded &&
        catalogueSelectionResolved && selectionContext?.mode === 'buyer';
}

function catalogueOpeningSession() {
    return local.getItem('siteAccountExit-v1') || 'initial';
}

function startCatalogueOpening() {
    if (wixWindowFrontend.viewMode !== 'Site' || getCatalogueAssistCustomerId()) return;
    try {
        if (!authentication.loggedIn() && session.getItem('catalogueAccess') !== 'granted' &&
            local.getItem('catalogueAccess') !== 'granted') return;
        if (session.getItem(CATALOGUE_OPENING_SEEN) === catalogueOpeningSession()) return;
        catalogueOpeningStartedAt = Date.now();
        $w('#section6').customClassList.add('catalogue-opening-active');
        catalogueOpeningTimer = setTimeout(() => finishCatalogueOpening(false), CATALOGUE_OPENING_MAX_MS);
    } catch (error) { finishCatalogueOpening(false); }
}

function finishCatalogueOpening(ready) {
    if (!catalogueOpeningStartedAt) return;
    catalogueOpeningStartedAt = 0;
    clearTimeout(catalogueOpeningTimer);
    try {
        $w('#section6').customClassList.remove('catalogue-opening-active');
        if (ready) session.setItem(CATALOGUE_OPENING_SEEN, catalogueOpeningSession());
    } catch (error) {}
    if (catalogueWorkspaceReady) {
        try { $w('#html5').postMessage({ type: 'catalogueOpeningFinished' }); } catch (error) {}
    }
}

function resetCatalogueReader() {
    finishCatalogueOpening(false);
    catalogueRestoreScope = null;
    cataloguePreparedFirst = null;
    catalogueWorkspaceRead = null;
    catalogueWorkspaceProducts = [];
    catalogueWorkspaceAllProducts = [];
    catalogueWorkspaceFullReadComplete = false;
    catalogueProductsLoaded = false;
    principleCache.clear();
    sendCatalogueWorkspaceData();
}

function prepCatalogueFirst(scope) {
    const key = JSON.stringify(scope);
    if (cataloguePreparedFirst?.key !== key) {
        cataloguePreparedFirst = { key, read: readCatalogue927(scope, 'FIRST').catch(() => null) };
    }
    return cataloguePreparedFirst.read;
}

function startCatalogueReader(scope) {
    if (!scope || catalogueRestoreScope) return;
    catalogueRestoreScope = scope;
    void loadCatalogueWorkspaceProducts();
}

function applyCatalogueProducts(rows, complete) {
    catalogueWorkspaceAllProducts = sortCatalogueProducts(rows.map(catalogueProductRecord).filter(item => item.id && item.name));
    catalogueWorkspaceProducts = catalogueWorkspaceAllProducts;
    catalogueWorkspaceFullReadComplete = complete;
    catalogueProductsLoaded = complete;
    rebuildCatalogueFoodMembership();
    sendCatalogueWorkspaceData();
}

function loadCatalogueWorkspaceProducts() {
    const scope = catalogueRestoreScope;
    if (!scope || catalogueWorkspaceFullReadComplete) return catalogueWorkspaceRead;
    if (!catalogueWorkspaceRead) {
        const first = prepCatalogueFirst(scope);
        catalogueWorkspaceRead = (async () => {
            const opening = await first;
            if (scope !== catalogueRestoreScope) return;
            const buyer = opening?.buyer;
            if (buyer?.companyId && buyer.companyId === scope.buyerCompanyId && !catalogueContextMessage) {
                sendCatalogueContext({
                    type: 'catalogueContext', mode: 'buyer',
                    sheetName: buyer.companyName || 'Buyer Account', signedInName: buyer.displayName || 'Buyer'
                });
            }
            if (opening?.rows.length) applyCatalogueProducts(opening.rows, false);
            const all = await readCatalogue927(scope, 'FULL');
            if (scope !== catalogueRestoreScope) return;
            applyCatalogueProducts(all, true);
        })().catch(error => {
            if (scope !== catalogueRestoreScope) return;
            console.error('Catalogue read did not complete', error);
            if (!catalogueWorkspaceProducts.length) catalogueWorkspaceFilter.homeState = 'failed';
            finishCatalogueOpening(false);
        }).finally(() => {
            if (scope !== catalogueRestoreScope) return;
            catalogueWorkspaceRead = null;
            sendCatalogueWorkspaceData();
        });
        sendCatalogueWorkspaceData();
    }
    return catalogueWorkspaceRead;
}

function showCatalogueCachedView({ query = '', subIds = [], principle = '', resetActive = true } = {}, position = null) {
    ++catalogueWorkspaceQueryVersion;
    catalogueWorkspaceFilter = { query, main: '', subIds, principle, resetActive };
    recordCatalogueBrowse(subIds, position);
    sendCatalogueWorkspaceData();
}

function showAllCatalogueWorkspaceProducts() {
    showCatalogueCachedView();
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
    catalogueAccessIssue = true;
    selectionContext = null;
    resetCatalogueReader();
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
    const assistCustomerId = getCatalogueAssistCustomerId();
    const requestedBuyerCompany = !assistCustomerId && authentication.loggedIn()
        ? selectedBuyerCompanyId(wixLocationFrontend) : '';
    let requestedCompanyAccess;
    if (typeof requestedBuyerCompany === 'string' && /^CUS-[A-Za-z0-9-]{1,80}$/.test(requestedBuyerCompany)) {
        void prepCatalogueFirst({ buyerCompanyId: requestedBuyerCompany });
        requestedCompanyAccess = loadBuyerCompanyAccess(getBuyerCompanies, requestedBuyerCompany).catch(() => null);
    }
    const assistedSelection = assistCustomerId ? getCatalogueSelectionState(assistCustomerId).catch(() => null) : null;
    let staff;
    try { staff = await getCurrentStaffContext(); } catch (error) { staff = null; }

    if (staff?.authorized) {
        finishCatalogueOpening(false);
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
                sendCatalogueContext({
                    type: 'catalogueContext', mode: staff.canViewAllCustomers ? 'admin' : 'assist',
                    sheetName: String(selection.companyName || selection.customerId).trim(),
                    signedInName: String(staff.staffName || staff.staffId || '').trim()
                });
                startCatalogueReader({ assistCustomerId: selection.customerId });
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
            sendCatalogueContext({ type: 'catalogueContext', mode: 'preview', signedInName: String(staff.staffName || staff.staffId || '').trim() });
            startCatalogueReader({ staffPreview: true });
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
            catalogueCompanyAccess = await requestedCompanyAccess ||
                await loadBuyerCompanyAccess(getBuyerCompanies, requestedCompanyId);
            if (catalogueCompanyAccess.blocked) finishCatalogueOpening(false);
            sendCatalogueCompanies();
            if (catalogueCompanyAccess.blocked) return;
            if (catalogueCompanyAccess.scoped) catalogueBuyerCompanyId = catalogueCompanyAccess.currentId;
            selectionContext = { mode: 'buyer', assistCustomerId: '' };
            if (catalogueBuyerCompanyId) startCatalogueReader({ buyerCompanyId: catalogueBuyerCompanyId });
            const state = await loadSelectionState(selectedCatalogueScope());
            if (state?.ok !== true || !state.customerId) throw new Error('Customer Catalogue access could not be verified.');
            sendCatalogueContext({
                type: 'catalogueContext', mode: 'buyer',
                sheetName: String(state?.companyName || 'Buyer Account').trim(),
                signedInName: String(state?.actorName || 'Buyer').trim()
            });
            await restoreMobileCataloguePosition(state.customerId);
            startCatalogueReader({ buyerCompanyId: state.customerId });
        } catch (error) {
            if (requestedCompanyId || catalogueBuyerCompanyId) { await denyCatalogueCompanyAccess(); return; }
            selectionContext = null;
            resetCatalogueReader();
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
            resetCatalogueReader();
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
        catalogueSubCategoryMainMap = new Map(result.items.map(item => [
            String(item._id || ''),
            String(item.mainCategory || '').trim().toUpperCase()
        ]).filter(([id, mainCategory]) => id && mainCategory));
        sendCatalogueMenu({
            type: 'catalogueMenuData',
            items: result.items.map(item => ({ id: item._id, title: String(item.title || '').trim(), mainCategory: String(item.mainCategory || '').trim().toUpperCase() })).filter(item => item.id && item.title && item.mainCategory)
        });
        rebuildCatalogueFoodMembership();
        sendCatalogueWorkspaceData();
    } catch (error) {
        console.error('Catalogue menu CMS load failed', error);
        sendCatalogueMenu({ type: 'catalogueMenuData', items: [] });
    } finally {
        catalogueCategoriesLoaded = true;
        sendCatalogueWorkspaceData();
    }
}

function rebuildCatalogueFoodMembership() {
    catalogueFoodProductIds = new Set();
    catalogueFoodPrinciples = new Set();
    for (const product of catalogueWorkspaceAllProducts) {
        const category = product.subCategoryIds.map(id => catalogueSubCategoryMainMap.get(id))
            .find(main => main?.startsWith('FOOD')) || product.mainCategory;
        if (!category.startsWith('FOOD')) continue;
        catalogueFoodProductIds.add(product.id);
        if (product.principle) catalogueFoodPrinciples.add(product.principle.toUpperCase());
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

    const applySearch = raw => showCatalogueCachedView({ query: String(raw || '').trim().slice(0, 120) });

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

    const applyMainCategory = async (main, resetActive = false) => {
        const items = catalogueMenuMessage && Array.isArray(catalogueMenuMessage.items)
            ? catalogueMenuMessage.items
            : [];
        const ids = items
            .filter(item => String(item.mainCategory || '').toUpperCase() === String(main || '').toUpperCase())
            .map(item => item.id)
            .filter(Boolean);
        if (ids.length) showCatalogueCachedView({ subIds: ids, resetActive });
    };

    const resetCatalogueHome = async () => {
        clearTimeout(searchTimer);
        if (nativeSearch) nativeSearch.value = '';
        header.postMessage({ type: 'catalogueHeaderFilter', query: '' });
        void hideMenu().catch(error => console.error('Catalogue menu could not close', error));
        void wixWindowFrontend.scrollTo(0, 0).catch(() => {});
        if (!catalogueMenuMessage) await menuReady;
        await applyMainCategory('FOOD', true);
    };
    $w('#imageX38').onClick(() => {
        resetCatalogueHome().catch(error => console.error('Catalogue home could not be opened', error));
    });
    try { $w('#vectorImage7').onClick(() => { void hideMenu(); openCatalogueAccountMenu(header); }); }
    catch (error) { /* The embedded account button remains available. */ }

    header.onMessage(async (event) => {
        const message = event.data || {};
        if (message.type === 'catalogueOpenAccountMenu') {
            void hideMenu();
            openCatalogueAccountMenu(header);
            return;
        }
        if (message.type === 'catalogueAccountMenuReady') {
            catalogueAccountMenuReady = true;
            if (catalogueAccountMenuRequested) openCatalogueAccountMenu(header);
            return;
        }
        if (message.type === 'catalogueAccountMenuClosed') {
            $w('#section7').customClassList.remove('catalogue-account-open');
            return;
        }
        if (message.type === 'catalogueAccountSignIn') {
            wixLocationFrontend.to('/');
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
            await showAllCatalogueWorkspaceProducts();
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
            const id = message.id || (catalogueMenuMessage?.items || []).find(item => item.title === message.sub)?.id;
            if (id && catalogueSubCategoryMainMap.has(id)) showCatalogueCachedView({ subIds: [id] });
            await hideMenu();
        } else if (message.type === 'catalogueGroup') {
            const requestedIds = new Set(Array.isArray(message.ids) ? message.ids : []);
            const ids = (catalogueMenuMessage?.items || []).map(item => item.id).filter(id => requestedIds.has(id));
            if (ids.length) showCatalogueCachedView({ subIds: ids });
            await hideMenu();
        } else if (message.type === 'cataloguePrinciple') {
            const principle = String(message.principle || '').trim();
            if (!principle) return;
            const subIds = message.subId && catalogueSubCategoryMainMap.has(message.subId) ? [message.subId] : [];
            showCatalogueCachedView({ subIds, principle });
            await hideMenu();
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
    let desktopHeightClass = '';
    catalogueAccountSession = connectAccountSession([$w('#html3'), $w('#html4'), workspace], '/');
    workspace.onMessage(async (event) => {
        const message = event.data || {};
        if (message.type === 'catalogueOpeningReady') {
            if (message.startedAt === catalogueOpeningStartedAt && catalogueOpeningDataReady()) {
                finishCatalogueOpening(true);
            }
            return;
        }
        if (message.type === 'catalogueDesktopHeight') {
            if (!Number.isFinite(message.height) || message.height <= 0) return;
            const step = Math.max(22, Math.min(55, Math.ceil(message.height / 24)));
            const next = 'catalogue-height-' + step;
            if (next === desktopHeightClass) return;
            const classes = $w('#section6').customClassList;
            if (desktopHeightClass) classes.remove(desktopHeightClass);
            classes.add(next);
            desktopHeightClass = next;
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
            lastWorkspaceProducts = null;
            catalogueWorkspaceReady = true;
            sendCatalogueCompanies();
            if (catalogueWorkspaceFullReadComplete || catalogueWorkspaceProducts.length) sendCatalogueWorkspaceData();
            else {
                if (catalogueOpeningStartedAt) sendCatalogueWorkspaceData();
                if (!catalogueWorkspaceRead) await loadCatalogueWorkspaceProducts();
            }
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
                showCatalogueCachedView({ subIds: ids });
                publishCatalogueSearchValue();
                return;
            }
            showCatalogueCachedView({ principle });
            publishCatalogueSearchValue();
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
        ['#html3', 'catalogue-navigation-frame'],
        ['#text21', 'catalogue-nav-placeholder'],
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
    startCatalogueOpening();
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
