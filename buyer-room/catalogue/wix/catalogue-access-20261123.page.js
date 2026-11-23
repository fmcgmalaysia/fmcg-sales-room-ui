import { authentication } from 'wix-members-frontend';
import wixLocationFrontend from 'wix-location-frontend';
import { local, session } from 'wix-storage-frontend';
import wixWindowFrontend from 'wix-window-frontend';
import wixData from 'wix-data';

import { getCurrentStaffContext } from 'backend/staffAuth.web.js';
import { addCatalogueSelection, getCatalogueSelectionState } from 'backend/catalogueSelection.web.js';

let catalogueContextMessage = null;
let catalogueMenuMessage = null;
let principleLogoMap = new Map();
const principleCache = new Map();
let logoLoadPromise;
let selectionContext = null;
let selectedProductIds = new Set();
let activeSelectedProductIds = new Set();
let removedProductIds = new Set();
let selectionBusyIds = new Set();
const CATALOGUE_BUILD_VERSION = '20261120-catalogue-compact-navigation-v1';
const joinedMobileSelections = new Set();
const MOBILE_SELECTION_FLIGHT_MS = 120000;
const NON_FOOD_CATEGORY_KEYS = new Set(['HOUSEHOLDS', 'PERSONAL CARE', 'OTHERS']);
const CATALOGUE_PRODUCT_FIELDS = [
    '_id', 'name', 'title', 'description', 'packingSize', 'ea', 'EA', 'price', 'barcode', 'unitBarcode',
    'innerBoxBarcode', 'cartonBarcode', 'm3Ctn', 'cbmPerCtn', 'cbm', 'principle', 'brandName', 'mainCategory',
    'image', 'countryOrigin', 'shelflife', 'shelfLife', 'pointBaseSortId', 'sortNo', 'sortNO', 'sortNumber',
    'sortOrder', 'subCategories', 'unitPrice', 'pricePerUnit', 'currency'
];
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
let catalogueFoodMembershipSubCategoryIds = null;
let catalogueHomeSnapshot = null;
let catalogueProductsLoaded = false;
let catalogueWorkspaceRead = null;
let catalogueFirstDisplayRead = null;
let catalogueWorkspaceFullReadComplete = false;
let catalogueWorkspaceSnapshotComplete = false;
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
        await showCatalogueWorkspaceQuery(wixData.query('FMCGMALAYSIA').hasSome('subCategories', subIds), subIds, { anchor, offset });
        return;
    }
    if (!catalogueWorkspaceFullReadComplete) await loadCatalogueWorkspaceProducts();
    if (!catalogueWorkspaceFullReadComplete || catalogueWorkspaceQueryVersion !== 0) return;
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
    const result = await wixData.query('FMCGMALAYSIA').eq('pointBaseStatus', 'ACTIVE').hasSome('subCategories', [subId]).limit(1000).distinct('principle');
    const names = (result.items || []).map(value => String(value || '').trim()).filter(Boolean);
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

function loadCatalogueWorkspaceProducts() {
    if (!catalogueWorkspaceRead) {
        const firstPageRead = wixData.query('FMCGMALAYSIA').eq('pointBaseStatus', 'ACTIVE')
            .fields(...CATALOGUE_PRODUCT_FIELDS).limit(1000).find();
        catalogueWorkspaceRead = readCatalogueWorkspaceProducts(catalogueWorkspaceQueryVersion, firstPageRead)
            .finally(() => { catalogueWorkspaceRead = null; });
        const fullRead = catalogueWorkspaceRead;
        catalogueFirstDisplayRead = Promise.race([
            fullRead,
            readCatalogueFirstProducts(catalogueWorkspaceQueryVersion, firstPageRead)
                .then(() => catalogueWorkspaceProducts.length ? undefined : fullRead)
        ]);
    }
    return catalogueWorkspaceRead;
}

async function readCatalogueFirstProducts(queryVersion, firstPageRead) {
    try {
        const brands = await wixData.query('FMCGMALAYSIA').eq('pointBaseStatus', 'ACTIVE').limit(1000).distinct('brandName');
        if (brands.hasNext() || catalogueWorkspaceFullReadComplete || queryVersion !== catalogueWorkspaceQueryVersion) return;
        const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
        const names = [...new Set(brands.items.filter(value => typeof value === 'string' && value.trim()))]
            .sort((left, right) => collator.compare(left.trim(), right.trim()));
        for (let count = Math.min(5, names.length); count > 0;) {
            let end = count;
            while (end < names.length && collator.compare(names[end - 1].trim(), names[end].trim()) === 0) end += 1;
            const result = await wixData.query('FMCGMALAYSIA').eq('pointBaseStatus', 'ACTIVE')
                .hasSome('brandName', names.slice(0, end)).fields(...CATALOGUE_PRODUCT_FIELDS).limit(1000).find();
            const firstPage = await firstPageRead;
            if (catalogueProductsLoaded || queryVersion !== catalogueWorkspaceQueryVersion || result.hasNext() ||
                !Number.isSafeInteger(firstPage.totalCount) || firstPage.totalCount > 10000) return;
            const products = sortCatalogueProducts(result.items.map(catalogueProductRecord).filter(item => item.id && item.name));
            if (products.length >= 50) {
                catalogueWorkspaceProducts = products.slice(0, 50);
                sendCatalogueWorkspaceData();
                return;
            }
            if (end === names.length) return;
            count = Math.min(names.length, Math.max(end + 1, end * 2));
        }
    } catch (error) {
        console.warn('Catalogue first products deferred to the full CMS read', error);
    }
}

async function readCatalogueWorkspaceProducts(queryVersion, firstPageRead = null) {
    try {
        const makeQuery = () => wixData.query('FMCGMALAYSIA').eq('pointBaseStatus', 'ACTIVE').fields(...CATALOGUE_PRODUCT_FIELDS);
        const firstPage = firstPageRead ? await firstPageRead : await makeQuery().limit(1000).find();
        let products = await readCataloguePagesInParallel(makeQuery, firstPage);
        if (!products) {
            products = [...firstPage.items];
            let result = firstPage;
            while (result.hasNext() && products.length < 10000) {
                result = await result.next();
                products.push(...result.items);
            }
        }
        catalogueWorkspaceAllProducts = sortCatalogueProducts(products.map(catalogueProductRecord).filter(item => item.id && item.name));
        catalogueWorkspaceSnapshotComplete = Number.isSafeInteger(firstPage.totalCount) && products.length >= firstPage.totalCount;
        catalogueWorkspaceFullReadComplete = true;
        if (queryVersion === catalogueWorkspaceQueryVersion) catalogueWorkspaceProducts = [...catalogueWorkspaceAllProducts];
    } catch (error) {
        console.error('Catalogue workspace CMS load failed', error);
        if (queryVersion === catalogueWorkspaceQueryVersion) catalogueWorkspaceProducts = [];
    }
    catalogueProductsLoaded = true;
    sendCatalogueWorkspaceData();
}

async function readCataloguePagesInParallel(makeQuery, firstPage) {
    const pageSize = firstPage.pageSize;
    const total = Math.min(firstPage.totalCount, 10000);
    if (!Number.isSafeInteger(total) || pageSize !== 1000 ||
        firstPage.items.length !== pageSize || total <= 2 * pageSize) return null;

    const products = [...firstPage.items];
    const ids = new Set(products.map(item => item._id));
    if (ids.size !== products.length || products.some(item => !item._id)) return null;
    const step = pageSize - 1;
    for (let offset = pageSize; offset < total;) {
        const requests = [];
        for (let slot = 0; slot < 3 && offset < total; slot += 1, offset += step) {
            const length = Math.min(step, total - offset);
            // The first item overlaps the preceding page to detect shifted offsets.
            requests.push(makeQuery().skip(offset - 1).limit(length + 1).find()
                .then(result => ({ result, length })).catch(() => null));
        }
        for (const page of await Promise.all(requests)) {
            if (!page || page.result.totalCount !== firstPage.totalCount ||
                page.result.items.length !== page.length + 1 ||
                page.result.items[0]._id !== products[products.length - 1]._id) return null;
            for (const item of page.result.items.slice(1)) {
                if (!item._id || ids.has(item._id)) return null;
                ids.add(item._id);
                products.push(item);
            }
        }
    }
    return products;
}

async function showCatalogueWorkspaceQuery(query, resumeSubIds = null, position = null, resetActive = false) {
    const queryVersion = ++catalogueWorkspaceQueryVersion;
    const products = [];
    try {
        let result = await query.eq('pointBaseStatus', 'ACTIVE').fields(...CATALOGUE_PRODUCT_FIELDS).limit(1000).find();
        products.push(...result.items);
        while (result.hasNext() && products.length < 10000) {
            result = await result.next();
            products.push(...result.items);
        }
        if (queryVersion !== catalogueWorkspaceQueryVersion) return;
        catalogueWorkspaceProducts = sortCatalogueProducts(products.map(catalogueProductRecord).filter(item => item.id && item.name));
        catalogueWorkspaceFilter = { query: '', main: '', subIds: [], principle: '' };
        if (resetActive) catalogueWorkspaceFilter.resetActive = true;
        recordCatalogueBrowse(resumeSubIds, position);
        sendCatalogueWorkspaceData();
    } catch (error) {
        console.error('Catalogue workspace filtered CMS load failed', error);
    }
}

async function showAllCatalogueWorkspaceProducts() {
    const queryVersion = ++catalogueWorkspaceQueryVersion;
    if (!catalogueWorkspaceFullReadComplete) await loadCatalogueWorkspaceProducts();
    if (queryVersion !== catalogueWorkspaceQueryVersion) return;
    catalogueWorkspaceProducts = [...catalogueWorkspaceAllProducts];
    catalogueWorkspaceFilter = { query: '', main: '', subIds: [], principle: '' };
    recordCatalogueBrowse([]);
    sendCatalogueWorkspaceData();
}

function sendCatalogueWorkspaceFilter(update) {
    catalogueWorkspaceFilter = { ...catalogueWorkspaceFilter, ...update };
    try { $w('#html5').postMessage({ type: 'catalogueWorkspaceFilter', ...catalogueWorkspaceFilter }); } catch (error) {}
}

let catalogueAccessIssue = false;
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
        try {
            selectionContext = { mode: 'buyer', assistCustomerId: '' };
            const state = await loadSelectionState('');
            if (state?.ok !== true || !state.customerId) throw new Error('Customer Catalogue access could not be verified.');
            sendCatalogueContext({
                type: 'catalogueContext', mode: 'buyer',
                sheetName: String(state?.companyName || 'Buyer Account').trim(),
                signedInName: String(state?.actorName || 'Buyer').trim()
            });
            restoreMobileCataloguePosition(state?.customerId)
                .catch(error => console.warn('Catalogue browsing position could not be restored', error));
        } catch (error) {
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
        try { await loadSelectionState(selectionContext.assistCustomerId || ''); }
        catch (error) {
            const expiredAssistCustomerId = String(selectionContext?.assistCustomerId || session.getItem('catalogueAssistCustomerId') || '').trim();
            if (expiredAssistCustomerId) {
                if(!authentication.loggedIn())wixLocationFrontend.to('/sales-room-login?next='+encodeURIComponent('/catalogue?assist='+expiredAssistCustomerId));
                else { const denied=/permission|not authorized|authorization is required|suspended|not found|not ready/i.test(error?.message||''); reportCatalogueAccess(denied?'Staff Management does not allow this customer Catalogue.':'Access is temporarily unavailable. The system is checking again.',denied); }
                return;
            }
            selectionContext = null;
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
        const foodSubCategoryIds = result.items
            .filter(item => String(item.mainCategory || '').trim().toUpperCase().startsWith('FOOD'))
            .map(item => item._id)
            .filter(Boolean);
        catalogueFoodProductIds = new Set();
        catalogueFoodPrinciples = new Set();
        catalogueFoodMembershipSubCategoryIds = null;
        if (foodSubCategoryIds.length) {
            // The menu is already available. Give the first visible products priority over this background scan.
            if (catalogueFirstDisplayRead) await catalogueFirstDisplayRead;
            let foodResult = await wixData.query('FMCGMALAYSIA').eq('pointBaseStatus', 'ACTIVE').hasSome('subCategories', foodSubCategoryIds).fields('_id', 'principle').limit(1000).find();
            foodResult.items.forEach(item => {
                catalogueFoodProductIds.add(String(item._id || ''));
                const principle = String(item.principle || '').trim().toUpperCase();
                if (principle) catalogueFoodPrinciples.add(principle);
            });
            while (foodResult.hasNext() && catalogueFoodProductIds.size < 10000) {
                foodResult = await foodResult.next();
                foodResult.items.forEach(item => {
                    catalogueFoodProductIds.add(String(item._id || ''));
                    const principle = String(item.principle || '').trim().toUpperCase();
                    if (principle) catalogueFoodPrinciples.add(principle);
                });
            }
            if (!foodResult.hasNext()) catalogueFoodMembershipSubCategoryIds = foodSubCategoryIds;
        }
        sendCatalogueWorkspaceData();
    } catch (error) {
        console.error('Catalogue menu CMS load failed', error);
        sendCatalogueMenu({ type: 'catalogueMenuData', items: [] });
    } finally {
        catalogueCategoriesLoaded = true;
        sendCatalogueWorkspaceData();
    }
}

function setupNav() {
    const header = $w('#html3');
    const mega = $w('#html4');
    const workspace = $w('#html5');
    const dataset = $w('#dataset1');
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

    const applySearch = async (rawQuery) => {
        const query = String(rawQuery || '').trim();
        const queryVersion = ++catalogueWorkspaceQueryVersion;
        if (!catalogueWorkspaceFullReadComplete) await loadCatalogueWorkspaceProducts();
        if (queryVersion !== catalogueWorkspaceQueryVersion) return;
        catalogueWorkspaceProducts = [...catalogueWorkspaceAllProducts];
        catalogueWorkspaceFilter = { query, main: '', subIds: [], principle: '' };
        recordCatalogueBrowse([]);
        sendCatalogueWorkspaceData();
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
        if (ids.length) {
            await Promise.all([
                dataset.setFilter(wixData.filter().hasSome('subCategories', ids)),
                showCatalogueWorkspaceQuery(
                    wixData.query('FMCGMALAYSIA').hasSome('subCategories', ids),
                    resetActive ? ids : null,
                    null,
                    resetActive
                )
            ]);
        }
    };

    const resetCatalogueHome = async () => {
        clearTimeout(searchTimer);
        const resetVersion = ++catalogueWorkspaceQueryVersion;
        if (nativeSearch) nativeSearch.value = '';
        header.postMessage({ type: 'catalogueHeaderFilter', query: '' });
        void hideMenu().catch(error => console.error('Catalogue menu could not close', error));
        void wixWindowFrontend.scrollTo(0, 0).catch(() => {});

        const setHomeView = (ids, products, homeState = '') => {
            catalogueWorkspaceProducts = products;
            catalogueWorkspaceFilter = { query: '', main: '', subIds: [], principle: '', resetActive: true, homeState };
            recordCatalogueBrowse(ids);
            sendCatalogueWorkspaceData();
        };
        if (!catalogueMenuMessage) {
            setHomeView([], [], 'loading');
            await menuReady;
        }
        if (catalogueWorkspaceQueryVersion !== resetVersion) return;
        const ids = (catalogueMenuMessage?.items || [])
            .filter(item => item.mainCategory === 'FOOD').map(item => item.id).filter(Boolean);
        if (!ids.length) {
            setHomeView([], [], 'failed');
            return;
        }
        const scope = new Set(ids);
        const key = JSON.stringify([...scope].sort());
        const sameMembership = catalogueFoodMembershipSubCategoryIds?.length === scope.size &&
            catalogueFoodMembershipSubCategoryIds.every(id => scope.has(id));
        const cachedProducts = catalogueHomeSnapshot?.key === key ? catalogueHomeSnapshot.products :
            catalogueWorkspaceSnapshotComplete && sameMembership
                ? catalogueWorkspaceAllProducts.filter(product => catalogueFoodProductIds.has(product.id)) : null;
        if (cachedProducts) {
            setHomeView(ids, cachedProducts);
            void dataset.setFilter(wixData.filter().hasSome('subCategories', ids))
                .catch(error => console.error('Catalogue dataset filter failed', error));
            return;
        }
        setHomeView(ids, [], 'loading');
        try { await applyMainCategory('FOOD', true); }
        finally {
            if (catalogueWorkspaceQueryVersion === resetVersion + 1) {
                if (catalogueWorkspaceFilter.homeState === 'loading') setHomeView(ids, [], 'failed');
                else catalogueHomeSnapshot = { key, products: catalogueWorkspaceProducts };
            }
        }
    };
    $w('#imageX38').onClick(() => {
        resetCatalogueHome().catch(error => console.error('Catalogue home could not be opened', error));
    });

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
            await dataset.setFilter(wixData.filter());
        } else if (message.type === 'catalogueAccount') {
            if (catalogueBrowseKey) {
                try { local.removeItem(catalogueBrowseKey); } catch (error) {}
                catalogueBrowseKey = '';
            }
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
            if (message.id) {
                await Promise.all([
                    dataset.setFilter(wixData.filter().hasSome('subCategories', [message.id])),
                    showCatalogueWorkspaceQuery(wixData.query('FMCGMALAYSIA').hasSome('subCategories', [message.id]))
                ]);
            }
            else {
                const result = await wixData.query('subCategories').eq('title', message.sub).limit(1).find();
                if (result.items.length) {
                    const subId = result.items[0]._id;
                    await Promise.all([
                        dataset.setFilter(wixData.filter().hasSome('subCategories', [subId])),
                        showCatalogueWorkspaceQuery(wixData.query('FMCGMALAYSIA').hasSome('subCategories', [subId]))
                    ]);
                }
            }
            hideMenu();
        } else if (message.type === 'catalogueGroup') {
            const requestedIds = new Set(Array.isArray(message.ids) ? message.ids : []);
            const ids = (catalogueMenuMessage?.items || []).map(item => item.id).filter(id => requestedIds.has(id));
            if (ids.length) {
                await Promise.all([
                    dataset.setFilter(wixData.filter().hasSome('subCategories', ids)),
                    showCatalogueWorkspaceQuery(wixData.query('FMCGMALAYSIA').hasSome('subCategories', ids), ids)
                ]);
            }
            hideMenu();
        } else if (message.type === 'cataloguePrinciple') {
            const principle = String(message.principle || '').trim();
            if (!principle) return;
            let filter = wixData.filter().eq('principle', principle);
            if (message.subId) filter = filter.hasSome('subCategories', [message.subId]);
            let query = wixData.query('FMCGMALAYSIA').eq('principle', principle);
            if (message.subId) query = query.hasSome('subCategories', [message.subId]);
            await Promise.all([dataset.setFilter(filter), showCatalogueWorkspaceQuery(query)]);
            hideMenu();
        }
    });

    setWorkspaceMenuState(false);
    mega.collapse();
    try { dataset.setPageSize(30); } catch (error) {}
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
    workspace.onMessage(async (event) => {
        const message = event.data || {};
        if (message.type === 'catalogueWorkspaceReady') {
            const instanceId = typeof message.instanceId === 'string' ? message.instanceId : '';
            if (instanceId && instanceId === catalogueWorkspaceInstance) return;
            catalogueWorkspaceInstance = instanceId;
            lastWorkspaceProducts = null;
            catalogueWorkspaceReady = true;
            if (catalogueWorkspaceFullReadComplete || catalogueWorkspaceProducts.length) sendCatalogueWorkspaceData();
            else if (!catalogueWorkspaceRead) await loadCatalogueWorkspaceProducts();
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
                await showCatalogueWorkspaceQuery(wixData.query('FMCGMALAYSIA').hasSome('subCategories', ids), ids);
                publishCatalogueSearchValue();
                return;
            }
            const queryVersion = ++catalogueWorkspaceQueryVersion;
            if (!catalogueWorkspaceFullReadComplete) await loadCatalogueWorkspaceProducts();
            if (queryVersion !== catalogueWorkspaceQueryVersion) return;
            if (principle && !catalogueWorkspaceAllProducts.some(product => product.principle.toLowerCase() === principle.toLowerCase())) return;
            catalogueWorkspaceProducts = [...catalogueWorkspaceAllProducts];
            catalogueWorkspaceFilter = { query: '', main: '', subIds: [], principle };
            recordCatalogueBrowse([]);
            publishCatalogueSearchValue();
            sendCatalogueWorkspaceData();
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
            const assistCustomerId = context.assistCustomerId || '';
            const flightKey = mobileSelectionFlightKey(productId);
            if (readMobileSelectionFlight(flightKey)?.expiresAt > Date.now()) {
                joinedMobileSelections.add(productId);
                return;
            }
            const flightOwner = claimMobileSelectionFlight(flightKey);
            try {
                const result = await addCatalogueSelection(productId, assistCustomerId);
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
                try {
                    const state = await getCatalogueSelectionState(assistCustomerId);
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
    loadCatalogueWorkspaceProducts();
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
    wixLocationFrontend.to(assistCustomerId ? '/buyer-room?assist=' + encodeURIComponent(assistCustomerId) : '/buyer-room');
}

function buyerRoomUrl(mode = catalogueContextMessage?.mode) {
    const preview = mode === 'preview';
    const url = new URL(preview ? 'sales-room' : 'buyer-room', new URL('.', wixLocationFrontend.url));
    if (preview) return url.href;
    const assistCustomerId = String(selectionContext?.assistCustomerId || '').trim();
    if (assistCustomerId) url.searchParams.set('assist', assistCustomerId);
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
