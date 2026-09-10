// Duration metadata for streaming WebM captured by MediaRecorder; no transcoding.
export async function addWebmDuration(blob, seconds) {
  if(!blob.type.includes('webm')||!Number.isFinite(seconds)||seconds<=0)return blob;
  const bytes=new Uint8Array(await blob.arrayBuffer());
  function vint(at, id=false){let n=1;while(n<=8&&!(bytes[at]&(1<<(8-n))))n++;if(n>8||at+n>bytes.length)throw Error('invalid');let value=BigInt(bytes[at]&(id?255:(1<<(8-n))-1));for(let i=1;i<n;i++)value=(value<<8n)+BigInt(bytes[at+i]);return {value,n,unknown:!id&&value===(1n<<BigInt(n*7))-1n}}
  function el(at){const id=vint(at,true),size=vint(at+id.n);return {id:Number(id.value),size:Number(size.value),unknown:size.unknown,sizeAt:at+id.n,n:size.n,start:at+id.n+size.n}}
  try{
    const head=el(0),segment=el(head.start+head.size);if(head.id!==0x1a45dfa3||segment.id!==0x18538067||!segment.unknown)return blob;
    const info=el(segment.start);if(info.id!==0x1549a966||info.unknown||info.start+info.size>bytes.length)return blob;
    let scale=1000000;
    for(let at=info.start;at<info.start+info.size;){const child=el(at);if([0x4489,0xbf].includes(child.id))return blob;if(child.id===0x2ad7b1){scale=0;for(let i=0;i<child.size;i++)scale=scale*256+bytes[child.start+i]}at=child.start+child.size}
    if(scale<=0)return blob;
    let length=BigInt(info.size+11);if(length>=(1n<<BigInt(info.n*7))-1n)return blob;
    const size=new Uint8Array(info.n);for(let i=info.n-1;i>=0;i--){size[i]=Number(length&255n);length>>=8n}size[0]|=1<<(8-info.n);
    const duration=new Uint8Array(11);duration.set([0x44,0x89,0x88]);new DataView(duration.buffer).setFloat64(3,seconds*1e9/scale,false);
    return new Blob([bytes.slice(0,info.sizeAt),size,bytes.slice(info.start,info.start+info.size),duration,bytes.slice(info.start+info.size)],{type:blob.type});
  }catch{return blob}
}
