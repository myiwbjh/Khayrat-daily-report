import {test,expect} from '@playwright/test';

test('overview gallery builds only selected newest-date photos and opens originals',async({page})=>{
  await page.goto('/');
  await page.evaluate(async()=>{
    const {renderLatestPhotoGallery}=await import('/src/latest-gallery.js');
    const target=document.createElement('div');target.id='test-latest-photos';document.body.append(target);
    const onePixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y8vR2IAAAAASUVORK5CYII=';
    window.testOpened='';
    renderLatestPhotoGallery(target,[
      {imageId:'new-1',relatedDate:'2026-10-10',relatedWorkshop:'水泥磨',dataUrl:onePixel},
      {imageId:'new-2',relatedDate:'2026-10-10',relatedWorkshop:'水泥库',dataUrl:onePixel}
    ],{openImage:id=>{window.testOpened=id;}});
  });
  await expect(page.locator('#test-latest-photos .latest-photo-tile')).toHaveCount(2);
  await page.locator('#test-latest-photos .latest-photo-tile').first().click();
  await expect.poll(()=>page.evaluate(()=>window.testOpened)).toBe('new-1');
});
