document.getElementById('run').onclick=async()=>{
  const output=document.getElementById('result');
  try{
    output.textContent='Running';
    const source=await(await fetch('../output/playwright/render-source.mp4')).blob();
    await StudioDB.put('sources',{key:'render-fixture',name:'render-source.mp4',blob:source});
    deepgramTranscribe=async()=>[{speaker:0,start:0,end:1,transcript:'First'},{speaker:1,start:.5,end:1.5,transcript:'Second'},{speaker:0,start:1,end:2,transcript:'Third'}];
    groqTranslateBatch=async items=>items.map(item=>({id:item.id,text:'سلام'}));
    fishTts=async()=>EasyTsAudio.wav(Float32Array.from({length:30000},(_,i)=>.3*Math.sin(2*Math.PI*440*i/24000)),24000);
    await prepareFileJob('render-fixture');
    const background=EasyTsAudio.wav(Float32Array.from({length:96000},(_,i)=>.15*Math.sin(2*Math.PI*220*i/24000)),24000);
    await StudioDB.put('sources',{key:'background-fixture',name:'background.wav',blob:background});
    await configureStudioMix({jobKey:currentJob.jobKey,revision:currentJob.revision,backgroundKey:'background-fixture',gain:.5,duck:.3});
    await renderStudioAudio({jobKey:currentJob.jobKey});
    const rendered=await StudioDB.get('exports',currentJob.jobKey);
    if(!rendered?.blob?.size)throw new Error('WAV missing');
    const decode=new AudioContext({sampleRate:24000});
    const wave=await decode.decodeAudioData(await rendered.blob.arrayBuffer());
    if(Math.abs(wave.duration-4)>.01)throw new Error('Background tail was truncated');
    const tail=wave.getChannelData(0).subarray(84000,90000);
    if(!tail.some(x=>Math.abs(x)>.01))throw new Error('Background absent from mix');
    await decode.close();
    await renderStudioVideo({jobKey:currentJob.jobKey});
    const video=await StudioDB.get('exports',`video:${currentJob.jobKey}`);
    if(!video?.blob?.size)throw new Error('Video missing');
    const checkVideo=document.createElement('video');checkVideo.src=URL.createObjectURL(video.blob);checkVideo.preload='auto';
    await new Promise((resolve,reject)=>{checkVideo.onloadeddata=resolve;checkVideo.onerror=reject;});
    if(checkVideo.videoWidth!==320||checkVideo.videoHeight!==180)throw new Error('Video dimensions changed');
    if(Math.abs(checkVideo.duration-4)>.05)throw new Error('Serialized audio or background tail was truncated in video');
    output.textContent=`PASS: WAV ${rendered.blob.size} bytes; WebM ${video.blob.size} bytes; ${checkVideo.videoWidth}x${checkVideo.videoHeight}; decoder accepted output.`;
    URL.revokeObjectURL(checkVideo.src);
  }catch(error){output.textContent=`FAIL: ${error.stack||error}`;}
};
