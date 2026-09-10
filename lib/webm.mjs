// Chrome MediaRecorder writes an unknown-length streaming Segment without Duration.
// Add that metadata to its leading Info element. This is not codec transcoding.
// Reference: https://www.matroska.org/technical/elements.html
function vint(buffer, at, keepMarker=false) {
  if(at>=buffer.length)throw Error('truncated');
  let width=1;while(width<=8&&!(buffer[at]&(1<<(8-width))))width++;
  if(width>8||at+width>buffer.length)throw Error('invalid vint');
  let value=BigInt(buffer[at]&(keepMarker?255:(1<<(8-width))-1));
  for(let i=1;i<width;i++)value=(value<<8n)+BigInt(buffer[at+i]);
  return {value,width,unknown:!keepMarker&&value===(1n<<BigInt(width*7))-1n};
}
function element(b,at){const id=vint(b,at,true),size=vint(b,at+id.width);return {id:Number(id.value),start:at+id.width+size.width,size:Number(size.value),unknown:size.unknown,sizeAt:at+id.width,sizeWidth:size.width}}
function sizeBytes(value,width){let n=BigInt(value);if(n>=(1n<<BigInt(width*7))-1n)throw Error('size overflow');const b=Buffer.alloc(width);for(let i=width-1;i>=0;i--){b[i]=Number(n&255n);n>>=8n}b[0]|=1<<(8-width);return b}
export function finalizeWebm(buffer,seconds) {
  try{
    if(!Number.isFinite(seconds)||seconds<=0)return buffer;
    const header=element(buffer,0);if(header.id!==0x1a45dfa3)return buffer;
    const segment=element(buffer,header.start+header.size);if(segment.id!==0x18538067||!segment.unknown)return buffer;
    const info=element(buffer,segment.start);if(info.id!==0x1549a966||info.unknown||info.start+info.size>buffer.length)return buffer;
    let scale=1000000;
    for(let at=info.start;at<info.start+info.size;){const child=element(buffer,at);if(child.id===0xbf||child.id===0x4489)return buffer;if(child.id===0x2ad7b1){scale=0;for(let i=0;i<child.size;i++)scale=scale*256+buffer[child.start+i]}at=child.start+child.size}
    if(!(scale>0))return buffer;
    const duration=Buffer.alloc(11);duration.set([0x44,0x89,0x88]);duration.writeDoubleBE(seconds*1e9/scale,3);
    return Buffer.concat([buffer.subarray(0,info.sizeAt),sizeBytes(info.size+11,info.sizeWidth),buffer.subarray(info.start,info.start+info.size),duration,buffer.subarray(info.start+info.size)]);
  }catch{return buffer}
}
