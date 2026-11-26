import test from 'node:test';
import assert from 'node:assert/strict';
import { withoutBuyerOriginalImages, buyerPreviewProducts } from '../backend/buyerMediaProjection.js';

test('legacy source photos are removed from nested selections and order lines without altering business data',()=>{
  const signedDocument='https://files.example.test/order.pdf';
  const order={id:'Q1',amount:13,lines:[{id:'item-1',orderQtyCtn:3,selectedAt:'2026-11-25',
    imageUrl:'https://static.wixstatic.com/media/photo.png',productReference:{imageUrl:'https://other.test/raw.png',eaPerCtn:5},
    poster:'wix:image://v1/loc.png/old.png'}],attachments:[{url:signedDocument}],issuedAt:new Date(0)};
  const result=withoutBuyerOriginalImages(order);
  assert.deepEqual(result,{...order,lines:[{id:'item-1',orderQtyCtn:3,selectedAt:'2026-11-25',
    productReference:{eaPerCtn:5},poster:''}]});
  assert.equal(order.lines[0].productReference.imageUrl,'https://other.test/raw.png');
});
test('both retailer company identities must match before previews can be allocated',()=>{
  const row=(id,outer,inner)=>({_id:id,customerId:outer,payload:{customerId:inner,productId:'p'}});
  assert.deepEqual(buyerPreviewProducts([row('ok','A','A'),row('bad1','A','B'),row('bad2','B','A')],'A',r=>r.payload),
    [{selectionId:'ok',id:'p'}]);
});
