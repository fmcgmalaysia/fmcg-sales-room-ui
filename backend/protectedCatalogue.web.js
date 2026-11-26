import { Permissions, webMethod } from 'wix-web-module';
import { getCatalogueProtection } from 'backend/catalogueProtectionRuntime.js';

export const listCataloguePage = webMethod(Permissions.SiteMember, async (scope, filters) => {
  const { read } = await getCatalogueProtection();
  return read.list(scope, filters);
});

export const readCatalogueProduct = webMethod(Permissions.SiteMember, async (scope, productId) => {
  const { read } = await getCatalogueProtection();
  return read.detail(scope, productId);
});

export const listCataloguePrinciples = webMethod(Permissions.SiteMember, async (scope, subcategory) => {
  const { read } = await getCatalogueProtection();
  return read.principles(scope, subcategory);
});

export const readCatalogueSelectionCounts = webMethod(Permissions.SiteMember, async scope => {
  const { read } = await getCatalogueProtection();
  return read.selectionCounts(scope);
});
