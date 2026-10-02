async (page) => {
  await page.getByText(/^PASS: WAV/).waitFor();
  for (const [key,name] of [['audio','rendered-dub.wav'],['video','rendered-dub.webm']]) {
    const downloadPromise=page.waitForEvent('download');
    await page.evaluate(async kind=>{
      const record=await StudioDB.get('exports',kind==='video'?`video:${currentJob.jobKey}`:currentJob.jobKey);
      const link=document.createElement('a');link.href=URL.createObjectURL(record.blob);link.download=kind==='video'?'dub.webm':'dub.wav';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),10000);
    },key);
    const download=await downloadPromise;await download.saveAs(`output/playwright/${name}`);
  }
  await page.evaluate(async()=>{
    await StudioDB.remove('exports',`video:${currentJob.jobKey}`);
    const pending=renderStudioVideo({jobKey:currentJob.jobKey});
    setTimeout(()=>stopAll(),500);
    try{await pending;throw new Error('Video export ignored stop');}catch(error){if(error.name!=='AbortError')throw error;}
    if(await StudioDB.get('exports',`video:${currentJob.jobKey}`))throw new Error('Cancelled video export published output');
    document.getElementById('result').textContent='PASS: actual WAV/WebM downloaded; cancelling video export stopped recording and published no stale output.';
  });
}
