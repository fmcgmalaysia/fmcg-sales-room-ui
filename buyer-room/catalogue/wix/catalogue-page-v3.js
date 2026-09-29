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
let activeSelectedProductIds = new Set();
let selectionBusyIds = new Set();
const CATALOGUE_BUILD_VERSION = '2026-09-29-catalogue-ea-v34';
let catalogueWorkspaceProducts = [];
let catalogueWorkspaceAllProducts = [];
let catalogueWorkspaceReady = false;
let catalogueSelectionLimit = 100;
let catalogueSelectionTotal = 0;
let catalogueWorkspaceFilter = { query: '', main: '', subIds: [], principle: '' };
let catalogueSubCategoryMainMap = new Map();
let catalogueFoodProductIds = new Set();
let catalogueFoodPrinciples = new Set();
let catalogueProductsLoaded = false;
let catalogueCategoriesLoaded = false;
let catalogueSelectionResolved = false;

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
    catalogueContextMessage = { ...message, buyerRoomUrl: buyerRoomUrl() };
    try { $w('#text19').text = String(message.sheetName || 'FMCG Malaysia').trim(); } catch (error) {}
    try { $w('#text20').text = String(message.signedInName || 'Buyer').trim(); } catch (error) {}
    try { $w('#html3').postMessage(catalogueContextMessage); } catch (error) {}
    sendCatalogueWorkspaceData();
}

function sendCatalogueMenu(message) {
    catalogueMenuMessage = message;
    try { $w('#html4').postMessage(message); } catch (error) {}
}

function sidebarSelectionState(state) {
    selectedProductIds = new Set((state?.selectedProductIds || []).map(String));
    activeSelectedProductIds = new Set((state?.activeSelectedProductIds || state?.selectedProductIds || []).map(String));
    catalogueSelectionLimit = Number(state?.selectionLimit) || 100;
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
        mainCategory: String(item?.mainCategory || '').trim().toUpperCase(),
        image: imageUrl(item?.image),
        countryOrigin: String(item?.countryOrigin || '').trim(),
        shelfLife: String(item?.shelflife || item?.shelfLife || '').trim(),
        subCategoryIds: catalogueReferenceIds(item?.subCategories),
        unitPrice: catalogueUnitPrice(item),
        currency: String(item?.currency || 'USD').trim().toUpperCase()
    };
}

function catalogueMainCategory(product) {
    if (catalogueFoodProductIds.has(product.id) || catalogueFoodPrinciples.has(product.principle.toUpperCase())) return 'FOOD';
    return (product.subCategoryIds || [])
        .map(subCategoryId => catalogueSubCategoryMainMap.get(String(subCategoryId)))
        .find(Boolean) || product.mainCategory || '';
}

function catalogueSelectionSummary() {
    const allById = new Map(catalogueWorkspaceAllProducts.map(product => [product.id, product]));
    const selectedProducts = [...activeSelectedProductIds].map(id => allById.get(id)).filter(Boolean);
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
        const selection = catalogueSelectionSummary();
        $w('#html5').postMessage({
            type: 'catalogueWorkspaceData',
            products: catalogueWorkspaceProducts.map(product => ({
                ...product,
                mainCategory: catalogueMainCategory(product)
            })),
            selectedProductIds: [...selectedProductIds],
            activeSelectedProductIds: [...activeSelectedProductIds],
            selectionProducts: selection.products,
            selectionLimit: catalogueSelectionLimit,
            selectionTotal: selection.total,
            selectionFoodCount: selection.food,
            selectionNonFoodCount: selection.nonFood,
            selectionCountsReady: catalogueProductsLoaded && catalogueCategoriesLoaded && catalogueSelectionResolved,
            buyerRoomUrl: buyerRoomUrl(),
            context: catalogueContextMessage,
            buildVersion: CATALOGUE_BUILD_VERSION
        });
        $w('#html5').postMessage({ type: 'catalogueWorkspaceFilter', ...catalogueWorkspaceFilter });
    } catch (error) {}
}

async function loadCatalogueWorkspaceProducts() {
    const products = [];
    try {
        let result = await wixData.query('FMCGMALAYSIA').ascending('name').limit(1000).find();
        products.push(...result.items);
        while (result.hasNext() && products.length < 10000) {
            result = await result.next();
            products.push(...result.items);
        }
        catalogueWorkspaceAllProducts = products.map(catalogueProductRecord).filter(item => item.id && item.name);
        catalogueWorkspaceProducts = [...catalogueWorkspaceAllProducts];
    } catch (error) {
        console.error('Catalogue workspace CMS load failed', error);
        catalogueWorkspaceProducts = [];
    }
    catalogueProductsLoaded = true;
    sendCatalogueWorkspaceData();
}

async function showCatalogueWorkspaceQuery(query) {
    const products = [];
    try {
        let result = await query.ascending('name').limit(1000).find();
        products.push(...result.items);
        while (result.hasNext() && products.length < 10000) {
            result = await result.next();
            products.push(...result.items);
        }
        catalogueWorkspaceProducts = products.map(catalogueProductRecord).filter(item => item.id && item.name);
        catalogueWorkspaceFilter = { query: '', main: '', subIds: [], principle: '' };
        sendCatalogueWorkspaceData();
    } catch (error) {
        console.error('Catalogue workspace filtered CMS load failed', error);
    }
}

function showAllCatalogueWorkspaceProducts() {
    catalogueWorkspaceProducts = [...catalogueWorkspaceAllProducts];
    catalogueWorkspaceFilter = { query: '', main: '', subIds: [], principle: '' };
    sendCatalogueWorkspaceData();
}

function sendCatalogueWorkspaceFilter(update) {
    catalogueWorkspaceFilter = { ...catalogueWorkspaceFilter, ...update };
    try { $w('#html5').postMessage({ type: 'catalogueWorkspaceFilter', ...catalogueWorkspaceFilter }); } catch (error) {}
}

async function loadSelectionState(assistCustomerId = '') {
    const state = await getCatalogueSelectionState(assistCustomerId);
    sidebarSelectionState(state);
    return state;
}

$w.onReady(async () => {
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
            catalogueSelectionResolved = true;
            sendCatalogueContext({ type: 'catalogueContext', mode: 'preview', signedInName: String(staff.staffName || staff.staffId || '').trim() });
        }
        return;
    }

    if (!hasBuyerAccess && wixWindowFrontend.viewMode === 'Site') { wixLocationFrontend.to('/'); return; }
    if (hasBuyerAccess) {
        try {
            selectionContext = { mode: 'buyer', assistCustomerId: '' };
            const state = await loadSelectionState('');
            sendCatalogueContext({
                type: 'catalogueContext', mode: 'buyer',
                sheetName: String(state?.companyName || 'Buyer Account').trim(),
                signedInName: String(state?.actorName || 'Buyer').trim()
            });
        } catch (error) {
            selectionContext = null;
            local.removeItem('catalogueAccess');
            session.removeItem('catalogueAccess');
            if (wixWindowFrontend.viewMode === 'Site') wixLocationFrontend.to('/buyer-room');
        }
    }
    setInterval(async () => {
        if (!selectionContext) return;
        try { await loadSelectionState(selectionContext.assistCustomerId || ''); }
        catch (error) {
            const expiredAssistCustomerId = String(selectionContext?.assistCustomerId || session.getItem('catalogueAssistCustomerId') || '').trim();
            selectionContext = null;
            selectedProductIds = new Set();
            activeSelectedProductIds = new Set();
            local.removeItem('catalogueAccess');
            session.removeItem('catalogueAccess');
            if (wixWindowFrontend.viewMode === 'Site') wixLocationFrontend.to(expiredAssistCustomerId ? '/sales-room' : '/buyer-room');
        }
    }, 15000);
});

async function loadMenuData() {
    try {
        const result = await wixData.query('subCategories').ascending('mainCategory').ascending('title').limit(1000).find();
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
        if (foodSubCategoryIds.length) {
            let foodResult = await wixData.query('FMCGMALAYSIA').hasSome('subCategories', foodSubCategoryIds).limit(1000).find();
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
    const dataset = $w('#dataset1');
    let nativeSearch;
    try { nativeSearch = $w('#input2'); } catch (error) {
        try { nativeSearch = $w('#input1'); } catch (fallbackError) { nativeSearch = null; }
    }
    let activeMain = 'FOOD';
    let isOpen = false;
    let lastScrollY = 0;
    let leaveTimer;

    const setWorkspaceMenuState = (open) => {
        try { $w('#html5').postMessage({ type: 'catalogueWorkspaceMenuState', open: Boolean(open) }); } catch (error) {}
    };

    const showMenu = async (main = activeMain) => {
        clearTimeout(leaveTimer);
        activeMain = main;
        if (!isOpen) await mega.expand();
        isOpen = true;
        setWorkspaceMenuState(true);
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
        setWorkspaceMenuState(false);
        await mega.collapse();
        isOpen = false;
        header.postMessage({ type: 'megaState', open: false, main: activeMain });
    };

    const applySearch = async (rawQuery) => {
        const query = String(rawQuery || '').trim();
        sendCatalogueWorkspaceFilter({ query });
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

    const applyMainCategory = async (main) => {
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
                showCatalogueWorkspaceQuery(wixData.query('FMCGMALAYSIA').hasSome('subCategories', ids))
            ]);
        }
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
            showAllCatalogueWorkspaceProducts();
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
            const ids = Array.isArray(message.ids) ? message.ids.filter(Boolean) : [];
            if (ids.length) {
                await Promise.all([
                    dataset.setFilter(wixData.filter().hasSome('subCategories', ids)),
                    showCatalogueWorkspaceQuery(wixData.query('FMCGMALAYSIA').hasSome('subCategories', ids))
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
    loadMenuData();
    logoLoadPromise = loadPrincipleLogos();
    setInterval(async () => {
        const currentY = (await wixWindowFrontend.getBoundingRect()).scroll.y;
        if (currentY - lastScrollY > 8 && currentY > 160) hideMenu();
        lastScrollY = currentY;
    }, 180);
}

function setupCatalogueWorkspace() {
    const workspace = $w('#html5');
    workspace.onMessage(async (event) => {
        const message = event.data || {};
        if (message.type === 'catalogueWorkspaceReady') {
            catalogueWorkspaceReady = true;
            if (!catalogueWorkspaceProducts.length) await loadCatalogueWorkspaceProducts();
            else sendCatalogueWorkspaceData();
        } else if (message.type === 'catalogueWorkspaceNavigate') {
            try { await wixWindowFrontend.scrollTo(0, 0); } catch (error) {}
        } else if (message.type === 'catalogueWorkspaceBuyerRoom') {
            openBuyerRoomWindow();
        } else if (message.type === 'catalogueWorkspaceSelect') {
            const productId = String(message.productId || '').trim();
            if (!selectionContext || !productId || selectionBusyIds.has(productId)) return;
            if (selectedProductIds.has(productId)) { openBuyerRoomWindow(); return; }
            selectionBusyIds.add(productId);
            try {
                const result = await addCatalogueSelection(productId, selectionContext.assistCustomerId || '');
                if (!result?.ok) throw new Error(result?.error || 'Quotation Desk selection sync failed.');
                selectedProductIds.add(productId);
                activeSelectedProductIds.add(productId);
                catalogueSelectionTotal = activeSelectedProductIds.size;
                workspace.postMessage({ type: 'catalogueWorkspaceSelection', ok: true, productId });
                sendCatalogueWorkspaceData();
                routeCatalogueSelection(result?.selection?.id, selectionContext.assistCustomerId || '')
                    .then(routeResult => { if (!routeResult?.ok) console.error('Background QD routing failed', routeResult?.error || routeResult); })
                    .catch(error => console.error('Background QD routing failed', error));
            } catch (error) {
                console.error('Catalogue workspace selection failed', error);
                workspace.postMessage({ type: 'catalogueWorkspaceSelection', ok: false, productId });
            } finally {
                selectionBusyIds.delete(productId);
            }
        }
    });
    loadCatalogueWorkspaceProducts();
}

function openBuyerRoom() {
    const assistCustomerId = String(selectionContext?.assistCustomerId || session.getItem('catalogueAssistCustomerId') || '').trim();
    wixLocationFrontend.to(assistCustomerId ? '/buyer-room?assist=' + encodeURIComponent(assistCustomerId) : '/buyer-room');
}

function buyerRoomUrl() {
    const url = new URL('buyer-room', new URL('.', wixLocationFrontend.url));
    const assistCustomerId = String(selectionContext?.assistCustomerId || session.getItem('catalogueAssistCustomerId') || '').trim();
    if (assistCustomerId) url.searchParams.set('assist', assistCustomerId);
    return url.href;
}

function openBuyerRoomWindow() {
    openBuyerRoom();
}

function setupFluidCatalogueLayout() {
    const classMap = [
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
    setupNav();
    setupCatalogueWorkspace();
});
