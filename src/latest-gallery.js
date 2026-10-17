// Latest-report evidence preview. All photo URLs remain private and are fetched on demand.
export function renderLatestPhotoGallery(root,photos,{token='',openImage=()=>{},max=24}={}){
  root.querySelector('.latest-photo-grid')?.remove();
  const items=photos.filter(photo=>photo?.imageId&&(photo.objectPath||photo.dataUrl||photo.publicUrl)).slice(0,max);
  if(!items.length)return;
  const grid=document.createElement('div');grid.className='latest-photo-grid';
  const observer='IntersectionObserver'in window?new IntersectionObserver(entries=>{
    for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);load(entry.target);}
  },{rootMargin:'180px'}):null;
  async function load(img){
    if(img.dataset.loaded)return;
    img.dataset.loaded='loading';
    const photo=items.find(item=>item.imageId===img.dataset.thumbImage);
    if(!photo)return;
    try{
      if(photo.dataUrl){img.src=photo.dataUrl;}
      else if(photo.publicUrl){img.src=photo.publicUrl+'&thumb=1';}
      else{
        if(!token)throw new Error('请先登录');
        const response=await fetch('/api/thumbnail',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({imageId:photo.imageId})});
        if(!response.ok)throw new Error('缩略图请求失败');
        img.src=URL.createObjectURL(await response.blob());
        img.onload=()=>URL.revokeObjectURL(img.src);
      }
      img.dataset.loaded='true';img.closest('.thumb')?.classList.add('loaded');
    }catch{
      img.dataset.loaded='failed';img.closest('.thumb')?.classList.add('load-failed');
      img.alt='缩略图暂不可用，点击尝试打开原图';
    }
  }
  for(const photo of items){
    const button=document.createElement('button');button.type='button';button.className='latest-photo-tile';
    button.setAttribute('aria-label','查看 '+(photo.relatedWorkshop||'现场')+' 原图');
    const frame=document.createElement('span');frame.className='thumb';
    const img=document.createElement('img');img.dataset.thumbImage=photo.imageId;img.loading='lazy';img.decoding='async';
    img.alt=photo.caption||((photo.relatedWorkshop||'现场')+' 施工照片');
    const placeholder=document.createElement('span');placeholder.textContent='缩略图加载中';
    frame.append(img,placeholder);
    const label=document.createElement('small');label.textContent=photo.relatedWorkshop||'未关联车间';
    button.append(frame,label);button.onclick=()=>openImage(photo.imageId);
    grid.append(button);if(observer)observer.observe(img);else if(grid.childElementCount<=4)load(img);
  }
  root.append(grid);
}
