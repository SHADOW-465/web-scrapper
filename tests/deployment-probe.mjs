// Read-only smoke checks for the public deployment, including route startup.
const origin = process.argv[2] || 'https://web-scrapper-ten.vercel.app';
for (const [path, body] of [['/', null], ['/api/access', null], ['/api/scan', {url:'http://localhost/'}], ['/api/scan',{url:'https://quotes.toscrape.com/scroll'}]]) {
  const start=Date.now();
  try {
    const res=await fetch(origin+path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});
    const text=await res.text();
    console.log(JSON.stringify({path,input:body?.url,status:res.status,contentType:res.headers.get('content-type'),vercelError:res.headers.get('x-vercel-error'),requestId:res.headers.get('x-vercel-id'),seconds:(Date.now()-start)/1000,body:text.slice(0,path==='/'?300:3500)}));
  } catch(e) {console.log(path,String(e));}
}
